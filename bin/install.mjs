#!/usr/bin/env node
// Instalador do muri-saver: copia skill, hooks e scripts pro lugar certo e
// faz merge (nunca sobrescrita destrutiva) dos hooks nos arquivos de config de
// cada agente. 100% não-interativo, pra rodar tanto por humano quanto por uma
// IA instalando pra outra pessoa.
//
// Grava <claude-dir>/muri-saver.json com alias, vault, fuso, agentes e um
// manifesto (caminho + sha256 de cada arquivo instalado). É isso que permite
// `--update` (reaproveita tudo sem repetir flags) e `--uninstall` (remove só o
// que foi instalado e não foi editado por você, movendo pra uma pasta de
// backup em vez de apagar).
//
// Não instala o binário ai-memory nem o app Obsidian (ver
// docs/ai-memory-obsidian-setup.md).

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, chmodSync, statSync,
  renameSync, unlinkSync, rmdirSync,
} from 'node:fs';
import { join, dirname, relative, isAbsolute } from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  DEFAULT_ALIAS, configPath, readConfig, writeConfig, systemTimezone, isValidTimezone,
  sha256File, sha256Text, readPackageVersion,
} from '../lib/config.mjs';
import { sanitizeAlias, renderWithAlias } from '../lib/alias.mjs';
import {
  mergeHooks, removeHooks, mergeAntigravityHooks, removeAntigravityHooks, resolveHomePlaceholder, jsonEqual,
} from '../lib/hooks-merge.mjs';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VERSION = readPackageVersion(REPO_ROOT);
const HOME = os.homedir();

const HELP = `
Uso: node bin/install.mjs [opções]      (ou: npx muri-saver install [opções])

Instalação
  --alias <nome>            Renomeia a skill e os gatilhos (padrão: muri-saver). Sinônimo: --skill-name
  --author-name <nome>      Cosmético, aparece no log e no muri-saver.json
  --vault <caminho>         Obsidian Vault usado pelos hooks e pelo ingestor (também cria as pastas)
  --timezone <IANA>         Fuso dos nomes de arquivo/diários (padrão: o do sistema; ex: America/Sao_Paulo)
  --with-antigravity        Configura Antigravity mesmo sem ~/.gemini detectado
  --with-codex              Configura Codex mesmo sem ~/.codex detectado
  --with-all                Os dois acima
  --with-companion-skills   Instala find-skills/tdd/prototype/grill-with-docs via npx skills
  --skip-claude-md          Não cria o CLAUDE.md

Ciclo de vida
  --update                  Reinstala usando o muri-saver.json salvo (flags passadas sobrescrevem)
  --uninstall               Remove o que foi instalado (arquivos editados por você são mantidos)
  --dry-run                 Só mostra o que faria

Diretórios (raramente necessário)
  --claude-dir, --skills-dir, --codex-dir, --gemini-dir <caminho>
`;

function parseArgs(argv) {
  const args = {};
  const takes = {
    '--claude-dir': 'claudeDir', '--skills-dir': 'skillsDir', '--codex-dir': 'codexDir', '--gemini-dir': 'geminiDir',
    '--vault': 'vault', '--alias': 'alias', '--skill-name': 'alias', '--author-name': 'authorName', '--timezone': 'timezone',
  };
  const flags = {
    '--dry-run': 'dryRun', '--skip-claude-md': 'skipClaudeMd', '--with-codex': 'withCodex', '--with-antigravity': 'withAntigravity',
    '--with-companion-skills': 'withCompanionSkills', '--update': 'update', '--uninstall': 'uninstall', '--help': 'help', '-h': 'help',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (takes[a]) args[takes[a]] = argv[++i];
    else if (flags[a]) args[flags[a]] = true;
    else if (a === '--with-all') { args.withCodex = true; args.withAntigravity = true; }
    else console.warn(`[muri-saver] AVISO: flag desconhecida ignorada: ${a}`);
  }
  return args;
}

function log(msg) {
  console.log(`[muri-saver] ${msg}`);
}

function readJson(path) {
  if (!existsSync(path)) return { exists: false, data: null };
  try {
    return { exists: true, data: JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return { exists: true, data: null, invalid: true };
  }
}

function platformLabel(p) {
  return { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[p] || p;
}

function stampNow() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// ------------------------------------------------------------------ context

function createContext({ dryRun, claudeDir, prevManifest = [] }) {
  const stamp = stampNow();
  return {
    dryRun,
    stamp,
    manifest: [],
    prev: new Map(prevManifest.map((e) => [e.path, e])),
    backupRoot: join(claudeDir, 'muri-saver-backups', stamp),
    counts: { written: 0, unchanged: 0, backups: 0, moved: 0, kept: 0 },
  };
}

function ensureDir(ctx, dir) {
  if (existsSync(dir)) return;
  if (!ctx.dryRun) mkdirSync(dir, { recursive: true });
}

function backupDestFor(ctx, file) {
  const rel = relative(HOME, file);
  const safe = !rel || rel.startsWith('..') || isAbsolute(rel) ? file.replace(/^[A-Za-z]:/, (m) => m[0]).replace(/^[\\/]+/, '') : rel;
  return join(ctx.backupRoot, safe);
}

// Every backup of one run lands in the same muri-saver-backups/<stamp>/
// folder, mirroring paths relative to home, so restoring is one copy back.
function backupCopy(ctx, path) {
  if (!existsSync(path)) return null;
  const dest = backupDestFor(ctx, path);
  log(`backup ${path} -> ${dest}`);
  if (!ctx.dryRun) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(path, dest);
  }
  ctx.counts.backups++;
  return dest;
}

function moveToBackup(ctx, file) {
  const dest = backupDestFor(ctx, file);
  if (ctx.dryRun) return dest;
  mkdirSync(dirname(dest), { recursive: true });
  try {
    renameSync(file, dest);
  } catch {
    copyFileSync(file, dest);
    unlinkSync(file);
  }
  try {
    rmdirSync(dirname(file));
  } catch {
    // parent not empty — fine
  }
  return dest;
}

function record(ctx, path, content, kind, extra = {}) {
  ctx.manifest.push({ path, sha256: sha256Text(content), kind, ...extra });
}

function writeManaged(ctx, dest, content, kind, extra = {}) {
  const current = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
  record(ctx, dest, content, kind, extra);
  if (current === content) {
    ctx.counts.unchanged++;
    return false;
  }
  // Overwriting something the installer didn't write last time (a file that
  // predates muri-saver, or one you edited since) gets a backup first.
  const prev = ctx.prev.get(dest);
  if (current !== null && (!prev || sha256Text(current) !== prev.sha256)) backupCopy(ctx, dest);
  log(`${current === null ? 'criar' : 'atualizar'} ${dest}`);
  if (!ctx.dryRun) {
    ensureDir(ctx, dirname(dest));
    writeFileSync(dest, content, 'utf8');
  }
  ctx.counts.written++;
  return true;
}

function copyManaged(ctx, src, dest, kind, transform) {
  const raw = readFileSync(src, 'utf8');
  return writeManaged(ctx, dest, transform ? transform(raw) : raw, kind);
}

// Only files the installer created and that nobody edited since then get
// refreshed; anything else is reported and left alone.
function writeGovernance(ctx, src, dest, alias) {
  const content = renderWithAlias(readFileSync(src, 'utf8'), alias);
  const prev = ctx.prev.get(dest);
  if (!existsSync(dest)) {
    log(`criar ${dest}`);
    if (!ctx.dryRun) {
      ensureDir(ctx, dirname(dest));
      writeFileSync(dest, content, 'utf8');
    }
    record(ctx, dest, content, 'governance', { created: true });
    ctx.counts.written++;
    return;
  }
  const currentHash = sha256File(dest);
  if (prev?.kind === 'governance' && prev.created && currentHash === prev.sha256) {
    if (currentHash === sha256Text(content)) {
      ctx.manifest.push(prev);
      ctx.counts.unchanged++;
      return;
    }
    backupCopy(ctx, dest);
    log(`atualizar ${dest} (criado pelo muri-saver e não editado desde então)`);
    if (!ctx.dryRun) writeFileSync(dest, content, 'utf8');
    record(ctx, dest, content, 'governance', { created: true });
    ctx.counts.written++;
    return;
  }
  if (prev) ctx.manifest.push(prev);
  log(`AVISO: ${dest} já existe e é seu (ou foi editado) — não sobrescrevi. Compare com: ${relative(process.cwd(), src) || src}`);
}

function mergeJsonFile(ctx, path, label, compute) {
  const { exists, data, invalid } = readJson(path);
  if (invalid) {
    log(`AVISO: ${path} não é JSON válido — não mexi nele (${label}).`);
    return false;
  }
  const before = data || {};
  const after = compute(before);
  if (exists && jsonEqual(before, after)) {
    log(`${path} já está atualizado (${label}).`);
    return false;
  }
  backupCopy(ctx, path);
  log(`gravar ${path} (${label})`);
  if (!ctx.dryRun) {
    ensureDir(ctx, dirname(path));
    writeFileSync(path, JSON.stringify(after, null, 2) + '\n', 'utf8');
  }
  return true;
}

function loadSnippet(relPath) {
  const snippet = JSON.parse(readFileSync(join(REPO_ROOT, relPath), 'utf8'));
  return resolveHomePlaceholder(snippet, HOME);
}

// ------------------------------------------------------------------ steps

function installSkills(ctx, skillsDir, alias) {
  copyManaged(ctx, join(REPO_ROOT, 'skills', 'muri-saver', 'SKILL.md'), join(skillsDir, alias, 'SKILL.md'), 'skill',
    (c) => renderWithAlias(c, alias));
  copyManaged(ctx, join(REPO_ROOT, 'skills', 'grill-me', 'SKILL.md'), join(skillsDir, 'grill-me', 'SKILL.md'), 'skill');
}

function installFlatDir(ctx, srcDir, destDir, kind) {
  for (const f of readdirSync(srcDir)) {
    const full = join(srcDir, f);
    if (statSync(full).isDirectory()) continue;
    const dest = join(destDir, f);
    const changed = copyManaged(ctx, full, dest, kind);
    if (changed && !ctx.dryRun && /\.(sh|py)$/.test(f)) {
      try {
        chmodSync(dest, 0o755);
      } catch {
        // best-effort (Windows)
      }
    }
  }
}

function installClaudeSettings(ctx, claudeDir, prevCfg) {
  const snippet = loadSnippet(join('claude-config', 'settings.snippet.json'));
  const path = join(claudeDir, 'settings.json');
  let statusLineInstalled = Boolean(prevCfg?.statusLineInstalled);
  mergeJsonFile(ctx, path, 'hooks Stop/SessionStart do muri-saver', (existing) => {
    const result = { ...existing, hooks: mergeHooks(existing.hooks, snippet.hooks) };
    if (!existing.statusLine) {
      result.statusLine = snippet.statusLine;
      statusLineInstalled = true;
    } else if (!jsonEqual(existing.statusLine, snippet.statusLine)) {
      log('settings.json já tem um statusLine seu — mantido. Veja claude-config/settings.snippet.json pra adotar o do muri-saver.');
      statusLineInstalled = false;
    }
    return result;
  });
  return { hookTarget: { kind: 'claude-settings', path }, statusLineInstalled };
}

function installCodex(ctx, codexDir, alias) {
  copyManaged(ctx, join(REPO_ROOT, 'hooks', 'codex', 'obsidian-codex-session.mjs'), join(codexDir, 'hooks', 'obsidian-codex-session.mjs'), 'hook');
  writeGovernance(ctx, join(REPO_ROOT, 'codex-config', 'AGENTS.md.template'), join(codexDir, 'AGENTS.md'), alias);
  const snippet = loadSnippet(join('codex-config', 'hooks.snippet.json'));
  const path = join(codexDir, 'hooks.json');
  mergeJsonFile(ctx, path, 'hook Stop do muri-saver pro Codex', (existing) => ({
    ...existing, hooks: mergeHooks(existing.hooks, snippet.hooks),
  }));
  return { kind: 'codex-hooks', path };
}

function installAntigravity(ctx, geminiDir, alias) {
  const skillsDir = join(geminiDir, 'config', 'skills');
  installSkills(ctx, skillsDir, alias);
  writeGovernance(ctx, join(REPO_ROOT, 'antigravity-config', 'GEMINI.md.template'), join(geminiDir, 'GEMINI.md'), alias);
  const snippet = loadSnippet(join('antigravity-config', 'hooks.snippet.json'));
  const path = join(geminiDir, 'config', 'hooks.json');
  mergeJsonFile(ctx, path, 'hook Stop do muri-saver pro Antigravity', (existing) => mergeAntigravityHooks(existing, snippet));
  return { kind: 'gemini-hooks', path };
}

const COMPANION_SKILLS = [
  'vercel-labs/skills@find-skills',
  'mattpocock/skills@tdd',
  'mattpocock/skills@prototype',
  'mattpocock/skills@grill-with-docs',
];

function installCompanionSkills(dryRun) {
  log('Skills companheiras de terceiros via `npx skills add` (créditos e licenças em docs/skills-companion.md):');
  for (const pkg of COMPANION_SKILLS) {
    log(`  npx skills add ${pkg}`);
    if (dryRun) continue;
    try {
      execSync(`npx skills add ${pkg} -y`, { stdio: 'inherit' });
    } catch {
      log(`  AVISO: falhou instalar ${pkg} — rode manualmente depois, ou "npx skills find <nome> --owner <owner>".`);
    }
  }
}

function scaffoldVault(ctx, vault) {
  for (const d of ['dailies', join('claude', 'sessions'), join('antigravity', 'sessions'), join('codex', 'sessions'), join('codex', 'dailies'), 'overview', 'projects']) {
    ensureDir(ctx, join(vault, d));
  }
  log(`vault pronto em ${vault} (dailies/, claude|antigravity|codex/sessions/, overview/, projects/)`);
}

// Files from a previous install that this run no longer writes (e.g. the old
// skill folder after switching --alias) are moved to the backup folder, but
// only if untouched since the installer wrote them.
function cleanupStale(ctx) {
  const current = new Set(ctx.manifest.map((e) => e.path));
  for (const [path, entry] of ctx.prev) {
    if (current.has(path) || entry.kind === 'governance' || !existsSync(path)) continue;
    if (sha256File(path) !== entry.sha256) {
      log(`AVISO: ${path} não é mais instalado mas foi editado por você — mantido.`);
      ctx.counts.kept++;
      continue;
    }
    const dest = moveToBackup(ctx, path);
    log(`arquivo antigo não mais usado movido pra ${dest}`);
    ctx.counts.moved++;
  }
}

// ------------------------------------------------------------------ uninstall

function uninstall(args, claudeDir) {
  const cfgPath = configPath({ claudeDir });
  const cfg = readConfig(cfgPath);
  if (!cfg) {
    log(`Nenhuma instalação registrada em ${cfgPath} — nada a remover.`);
    log('Instalou antes da v2? Rode `node bin/install.mjs` uma vez (registra o que já está instalado) e depois --uninstall.');
    return;
  }
  const ctx = createContext({ dryRun: args.dryRun, claudeDir });
  if (ctx.dryRun) log('MODO --dry-run: nada será removido.');

  for (const entry of cfg.manifest || []) {
    if (!existsSync(entry.path)) continue;
    if (sha256File(entry.path) !== entry.sha256) {
      log(`mantido (editado por você): ${entry.path}`);
      ctx.counts.kept++;
      continue;
    }
    log(`remover ${entry.path}`);
    moveToBackup(ctx, entry.path);
    ctx.counts.moved++;
  }

  const snippets = {
    'claude-settings': loadSnippet(join('claude-config', 'settings.snippet.json')),
    'codex-hooks': loadSnippet(join('codex-config', 'hooks.snippet.json')),
    'gemini-hooks': loadSnippet(join('antigravity-config', 'hooks.snippet.json')),
  };
  let hookFiles = 0;
  for (const target of cfg.hookTargets || []) {
    const { data, invalid } = readJson(target.path);
    if (!data || invalid) continue;
    const snippet = snippets[target.kind];
    let after;
    if (target.kind === 'gemini-hooks') {
      after = removeAntigravityHooks(data, snippet);
    } else {
      after = { ...data, hooks: removeHooks(data.hooks, snippet.hooks) };
      if (Object.keys(after.hooks).length === 0) delete after.hooks;
      if (target.kind === 'claude-settings' && cfg.statusLineInstalled && jsonEqual(data.statusLine, snippet.statusLine)) delete after.statusLine;
    }
    if (jsonEqual(data, after)) continue;
    log(`remover hooks do muri-saver de ${target.path}`);
    if (!ctx.dryRun) {
      const dest = backupDestFor(ctx, target.path);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(target.path, dest);
      writeFileSync(target.path, JSON.stringify(after, null, 2) + '\n', 'utf8');
    }
    hookFiles++;
  }

  log(`remover ${cfgPath}`);
  moveToBackup(ctx, cfgPath);

  log(`Pronto: ${ctx.counts.moved} arquivo(s) removido(s), ${ctx.counts.kept} mantido(s) por terem sido editados, hooks removidos de ${hookFiles} arquivo(s) de config.`);
  if (!ctx.dryRun) log(`Tudo que saiu está em ${ctx.backupRoot} — pra desfazer, copie de volta.`);
  log('Não removido de propósito: vault do Obsidian, dados do ai-memory e skills companheiras de terceiros.');
}

// ------------------------------------------------------------------ main

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(HELP);

  const claudeDir = args.claudeDir || join(HOME, '.claude');
  log(`muri-saver ${VERSION} — SO: ${platformLabel(process.platform)} (${process.platform}/${process.arch}) — home: ${HOME}`);
  if (args.uninstall) return uninstall(args, claudeDir);

  const cfgPath = configPath({ claudeDir });
  const prevCfg = readConfig(cfgPath);
  if (args.update && !prevCfg) {
    log(`FALHA: --update precisa de uma instalação anterior registrada em ${cfgPath}. Rode sem --update.`);
    process.exitCode = 1;
    return;
  }
  if (args.timezone && !isValidTimezone(args.timezone)) {
    log(`FALHA: --timezone "${args.timezone}" não é um fuso IANA válido (ex: America/Sao_Paulo, Europe/Lisbon, UTC).`);
    process.exitCode = 1;
    return;
  }

  const paths = {
    claudeDir,
    skillsDir: args.skillsDir || prevCfg?.paths?.skillsDir || join(HOME, '.agents', 'skills'),
    codexDir: args.codexDir || prevCfg?.paths?.codexDir || join(HOME, '.codex'),
    geminiDir: args.geminiDir || prevCfg?.paths?.geminiDir || join(HOME, '.gemini'),
  };
  const alias = sanitizeAlias(args.alias || prevCfg?.alias);
  const authorName = args.authorName ? String(args.authorName).trim() : (prevCfg?.authorName || null);
  const vault = args.vault || prevCfg?.vault || null;
  const timezone = args.timezone || prevCfg?.timezone || systemTimezone();
  const prevAgents = new Set(prevCfg?.agents || []);
  const wantCodex = args.withCodex || prevAgents.has('codex') || existsSync(paths.codexDir);
  const wantAntigravity = args.withAntigravity || prevAgents.has('antigravity') || existsSync(paths.geminiDir);

  const ctx = createContext({ dryRun: args.dryRun, claudeDir, prevManifest: prevCfg?.manifest });
  if (ctx.dryRun) log('MODO --dry-run: nada será escrito.');
  if (prevCfg) log(`Instalação anterior encontrada (${prevCfg.version || '?'}, alias "${prevCfg.alias}") — reaproveitando a config salva.`);
  if (alias !== DEFAULT_ALIAS) log(`Alias personalizado: "${alias}"${authorName ? ` (autor: ${authorName})` : ''} — "muri-saver" continua como alias alternativo.`);
  log(`Fuso: ${timezone}${vault ? ` — vault: ${vault}` : ''}`);

  installSkills(ctx, paths.skillsDir, alias);
  installFlatDir(ctx, join(REPO_ROOT, 'hooks'), join(claudeDir, 'hooks'), 'hook');
  installFlatDir(ctx, join(REPO_ROOT, 'scripts'), join(claudeDir, 'scripts'), 'script');
  const settings = installClaudeSettings(ctx, claudeDir, prevCfg);
  const hookTargets = [settings.hookTarget];
  if (args.skipClaudeMd) log('--skip-claude-md: CLAUDE.md não foi tocado.');
  else writeGovernance(ctx, join(REPO_ROOT, 'claude-config', 'CLAUDE.md.template'), join(claudeDir, 'CLAUDE.md'), alias);
  if (vault) scaffoldVault(ctx, vault);

  const agents = ['claude'];
  if (wantCodex) {
    hookTargets.push(installCodex(ctx, paths.codexDir, alias));
    agents.push('codex');
  } else {
    log('~/.codex não encontrado — Codex pulado (use --with-codex pra forçar).');
  }
  if (wantAntigravity) {
    hookTargets.push(installAntigravity(ctx, paths.geminiDir, alias));
    agents.push('antigravity');
  } else {
    log('~/.gemini não encontrado — Antigravity pulado (use --with-antigravity pra forçar).');
  }
  if (args.withCompanionSkills) installCompanionSkills(ctx.dryRun);
  cleanupStale(ctx);

  const now = new Date().toISOString();
  const config = {
    version: VERSION,
    installedAt: prevCfg?.installedAt || now,
    updatedAt: now,
    alias,
    authorName,
    vault,
    timezone,
    agents,
    paths,
    statusLineInstalled: settings.statusLineInstalled,
    hookTargets,
    manifest: ctx.manifest,
  };
  if (!ctx.dryRun) writeConfig(cfgPath, config);

  const { written, unchanged, backups, moved } = ctx.counts;
  log(`Pronto: ${written} arquivo(s) criado(s)/atualizado(s), ${unchanged} já em dia, ${backups} backup(s), ${moved} antigo(s) movido(s). Config: ${cfgPath}`);
  log('Próximos passos (detalhes em INSTALL-AI.md):');
  log('  1. ai-memory: instalar o binário e rodar `ai-memory install-hooks --client claude-code`.');
  log('  2. MCP: mesclar mcp/mcp-servers.example.json no ~/.claude.json com o caminho real do vault.');
  log('  3. Reiniciar Claude Code/Antigravity/Codex pra carregar skill, hooks e governança.');
  log('  4. `node bin/doctor.mjs` pra conferir tudo.');
  log('  5. Opcional: `node bin/ingest-sessions.mjs --all --dry-run` pra importar sessões antigas.');
  log('  Atualizar depois: `node bin/install.mjs --update` · Remover: `node bin/install.mjs --uninstall`.');
}

main();
