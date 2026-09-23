#!/usr/bin/env node
// Instalador do muri-saver. Copia a skill, os hooks e os scripts pro lugar
// certo, e faz merge (nunca sobrescrita destrutiva) das chaves relevantes em
// ~/.claude/settings.json. Feito pra ser rodado tanto por um humano quanto
// por uma IA (Claude Code, Codex, etc.) instalando isso pra outra pessoa —
// por isso é 100% não-interativo, só flags de linha de comando.
//
// Uso (rodar a partir da raiz do repositório):
//   node bin/install.mjs [--claude-dir <path>] [--skills-dir <path>] [--vault <path>]
//                         [--dry-run] [--skip-claude-md] [--with-codex] [--with-companion-skills]
//
// Padrões: --claude-dir = ~/.claude, --skills-dir = ~/.agents/skills
// Detecta o SO sozinho (darwin/linux/win32) via os.homedir()/process.platform
// — os mesmos caminhos relativos à home funcionam nos três.
//
// O que este script NÃO faz (de propósito):
//   - Não instala o binário `ai-memory` nem roda `ai-memory install-hooks`
//     (isso é do instalador oficial do ai-memory, ver docs/ai-memory-obsidian-setup.md).
//   - Não instala o app Obsidian.
//   - Não sobrescreve um CLAUDE.md ou settings.json existente sem avisar —
//     sempre faz backup antes de tocar em algo que já existe.

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, chmodSync, statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // bin/install.mjs -> raiz do repo

function parseArgs(argv) {
  const args = { dryRun: false, skipClaudeMd: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--claude-dir') args.claudeDir = argv[++i];
    else if (a === '--skills-dir') args.skillsDir = argv[++i];
    else if (a === '--vault') args.vault = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--skip-claude-md') args.skipClaudeMd = true;
    else if (a === '--with-codex') args.withCodex = true;
    else if (a === '--with-companion-skills') args.withCompanionSkills = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function log(msg) {
  console.log(`[muri-saver] ${msg}`);
}

function ensureDir(dir, dryRun) {
  if (existsSync(dir)) return;
  log(`mkdir -p ${dir}`);
  if (!dryRun) mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest, dryRun) {
  log(`copiar ${src} -> ${dest}`);
  if (dryRun) return;
  ensureDir(dirname(dest), dryRun);
  copyFileSync(src, dest);
}

function backupIfExists(path, dryRun) {
  if (!existsSync(path)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${path}.bak-${stamp}`;
  log(`backup ${path} -> ${backupPath}`);
  if (!dryRun) copyFileSync(path, backupPath);
  return backupPath;
}

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// Mescla os hooks do snippet dentro do settings.json existente sem duplicar
// entradas nem apagar hooks que o usuário já tinha configurado.
function mergeHooks(existingHooks, snippetHooks) {
  const merged = { ...(existingHooks || {}) };
  for (const [event, entries] of Object.entries(snippetHooks)) {
    const current = Array.isArray(merged[event]) ? merged[event] : [];
    const currentSerialized = current.map((e) => JSON.stringify(e));
    const toAdd = entries.filter((e) => !currentSerialized.includes(JSON.stringify(e)));
    merged[event] = [...current, ...toAdd];
  }
  return merged;
}

function mergeSettings(claudeDir, dryRun) {
  const snippetPath = join(REPO_ROOT, 'claude-config', 'settings.snippet.json');
  const snippet = readJsonSafe(snippetPath);
  if (!snippet) {
    log('AVISO: não consegui ler claude-config/settings.snippet.json, pulando merge de settings.json.');
    return;
  }

  const home = os.homedir();
  const snippetStr = JSON.stringify(snippet).replaceAll('<HOME>', home);
  const resolvedSnippet = JSON.parse(snippetStr);

  const settingsPath = join(claudeDir, 'settings.json');
  const existing = readJsonSafe(settingsPath) || {};

  const result = { ...existing };
  result.hooks = mergeHooks(existing.hooks, resolvedSnippet.hooks);
  if (!existing.statusLine) {
    result.statusLine = resolvedSnippet.statusLine;
  } else {
    log('settings.json já tem statusLine configurado — não mexi nele. Veja claude-config/settings.snippet.json se quiser adotar o do muri-saver manualmente.');
  }

  backupIfExists(settingsPath, dryRun);
  log(`gravar ${settingsPath} (hooks Stop/SessionStart do muri-saver mesclados)`);
  if (!dryRun) {
    ensureDir(claudeDir, dryRun);
    writeFileSync(settingsPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  }
}

// Codex CLI é opcional: só mexemos em ~/.codex se a pasta já existir (sinal
// de que o usuário tem o Codex instalado) ou se --with-codex for passado.
function installCodexSupport(home, dryRun, force) {
  const codexDir = join(home, '.codex');
  if (!force && !existsSync(codexDir)) {
    log('~/.codex não encontrado — pulando suporte a Codex (use --with-codex pra forçar).');
    return;
  }

  const hookSrc = join(REPO_ROOT, 'hooks', 'codex', 'obsidian-codex-session.mjs');
  const hookDest = join(codexDir, 'hooks', 'obsidian-codex-session.mjs');
  copyFile(hookSrc, hookDest, dryRun);

  const snippetPath = join(REPO_ROOT, 'codex-config', 'hooks.snippet.json');
  const snippet = readJsonSafe(snippetPath);
  if (!snippet) {
    log('AVISO: não consegui ler codex-config/hooks.snippet.json, pulando merge de ~/.codex/hooks.json.');
    return;
  }
  const resolvedSnippet = JSON.parse(JSON.stringify(snippet).replaceAll('<HOME>', home));

  const hooksJsonPath = join(codexDir, 'hooks.json');
  const existing = readJsonSafe(hooksJsonPath) || { hooks: {} };
  const result = { ...existing, hooks: mergeHooks(existing.hooks, resolvedSnippet.hooks) };

  backupIfExists(hooksJsonPath, dryRun);
  log(`gravar ${hooksJsonPath} (hook Stop do muri-saver pro Codex mesclado)`);
  if (!dryRun) {
    ensureDir(codexDir, dryRun);
    writeFileSync(hooksJsonPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  }
}

function installClaudeMd(claudeDir, dryRun, skip) {
  if (skip) {
    log('--skip-claude-md: pulando CLAUDE.md de propósito.');
    return;
  }
  const dest = join(claudeDir, 'CLAUDE.md');
  const src = join(REPO_ROOT, 'claude-config', 'CLAUDE.md.template');
  if (existsSync(dest)) {
    log(`AVISO: ${dest} já existe — NÃO sobrescrevi. Compare com claude-config/CLAUDE.md.template e mescle manualmente o que quiser adotar.`);
    return;
  }
  copyFile(src, dest, dryRun);
}

function platformLabel(platform) {
  if (platform === 'darwin') return 'macOS';
  if (platform === 'win32') return 'Windows';
  if (platform === 'linux') return 'Linux';
  return platform;
}

// Skills companheiras que são de terceiros (não vendorizadas neste repo, ver
// docs/skills-companion.md) — instaladas via `npx skills add` só quando
// --with-companion-skills for passado. Falha isolada por pacote não aborta o
// resto (rede instável, skills.sh fora do ar, etc. não devem travar o resto
// da instalação).
const COMPANION_SKILLS = [
  'vercel-labs/skills@find-skills',
  'mattpocock/skills@tdd',
  'mattpocock/skills@prototype',
  'mattpocock/skills@grill-with-docs',
];

function installCompanionSkills(dryRun) {
  log('Instalando skills companheiras de terceiros via `npx skills add` (ver docs/skills-companion.md para créditos e licenças)...');
  for (const pkg of COMPANION_SKILLS) {
    log(`  npx skills add ${pkg}`);
    if (dryRun) continue;
    try {
      execSync(`npx skills add ${pkg} -y`, { stdio: 'inherit' });
    } catch {
      log(`  AVISO: falhou instalar ${pkg} automaticamente — rode manualmente depois, ou use "npx skills find <nome> --owner <owner>".`);
    }
  }
  log('openspec, graphify e impeccable não têm um `npx skills add` confiável — ver docs/skills-companion.md para o comando de instalação de cada um.');
}

function scaffoldVault(vaultPath, dryRun) {
  if (!vaultPath) return;
  const dirs = [
    'dailies',
    join('claude', 'sessions'),
    join('overview'),
    join('projects'),
  ];
  for (const d of dirs) {
    ensureDir(join(vaultPath, d), dryRun);
  }
  log(`vault escaneado em ${vaultPath} (dailies/, claude/sessions/, overview/, projects/)`);
  log('Lembre de trocar <CAMINHO_DO_SEU_VAULT> em mcp/mcp-servers.example.json por este caminho ao configurar o MCP do Obsidian.');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 20).join('\n'));
    return;
  }

  const home = os.homedir();
  const claudeDir = args.claudeDir || join(home, '.claude');
  const skillsDir = args.skillsDir || join(home, '.agents', 'skills');
  const dryRun = args.dryRun;

  log(`SO detectado: ${platformLabel(process.platform)} (${process.platform}/${process.arch}) — home: ${home}`);
  if (dryRun) log('MODO --dry-run: nada será escrito, só mostrando o que faria.');

  // 1. Skills próprias (100% originais, ver docs/skills-companion.md pras de terceiros)
  for (const skillName of ['muri-saver', 'grill-me']) {
    const skillDest = join(skillsDir, skillName, 'SKILL.md');
    copyFile(join(REPO_ROOT, 'skills', skillName, 'SKILL.md'), skillDest, dryRun);
  }

  // 2. Hooks (Claude Code / Antigravity — arquivos soltos, não a subpasta codex/)
  const hooksSrcDir = join(REPO_ROOT, 'hooks');
  const hooksDestDir = join(claudeDir, 'hooks');
  for (const f of readdirSync(hooksSrcDir)) {
    const full = join(hooksSrcDir, f);
    if (statSync(full).isDirectory()) continue;
    copyFile(full, join(hooksDestDir, f), dryRun);
  }

  // 3. Scripts
  const scriptsSrcDir = join(REPO_ROOT, 'scripts');
  const scriptsDestDir = join(claudeDir, 'scripts');
  for (const f of readdirSync(scriptsSrcDir)) {
    const dest = join(scriptsDestDir, f);
    copyFile(join(scriptsSrcDir, f), dest, dryRun);
    if (!dryRun && (f.endsWith('.sh') || f.endsWith('.py'))) {
      try { chmodSync(dest, 0o755); } catch { /* best-effort */ }
    }
  }

  // 4. settings.json (merge, não sobrescreve)
  mergeSettings(claudeDir, dryRun);

  // 5. CLAUDE.md (só cria se não existir)
  installClaudeMd(claudeDir, dryRun, args.skipClaudeMd);

  // 6. Vault (opcional)
  scaffoldVault(args.vault, dryRun);

  // 7. Codex (opcional — só se detectado ou forçado)
  installCodexSupport(home, dryRun, args.withCodex);

  // 8. Skills companheiras de terceiros (opcional, ver docs/skills-companion.md)
  if (args.withCompanionSkills) installCompanionSkills(dryRun);

  log('Pronto. Próximos passos manuais (ver INSTALL-AI.md para o passo a passo completo):');
  log('  1. Instalar o binário ai-memory e rodar `ai-memory install-hooks --client claude-code`.');
  log('  2. Mesclar mcp/mcp-servers.example.json em ~/.claude.json (ou config do seu client) com o caminho real do seu vault.');
  log('  3. Reiniciar o Claude Code pra carregar a skill, os hooks e o CLAUDE.md novos.');
  log('  4. Rodar `node doctor.mjs` pra verificar tudo automaticamente (Node/Python/Claude CLI/ai-memory/MCP/Obsidian/vault).');
}

main();
