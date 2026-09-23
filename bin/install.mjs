#!/usr/bin/env node
// Instalador do muri-saver. Copia a skill, os hooks e os scripts pro lugar
// certo, e faz merge (nunca sobrescrita destrutiva) das chaves relevantes em
// ~/.claude/settings.json. Feito pra ser rodado tanto por um humano quanto
// por uma IA (Claude Code, Codex, etc.) instalando isso pra outra pessoa —
// por isso é 100% não-interativo, só flags de linha de comando.
//
// Uso (rodar a partir da raiz do repositório):
//   node bin/install.mjs [--claude-dir <path>] [--skills-dir <path>] [--vault <path>]
//                         [--codex-dir <path>] [--gemini-dir <path>]
//                         [--alias <nome>] [--author-name <nome>]
//                         [--dry-run] [--skip-claude-md]
//                         [--with-codex] [--with-antigravity] [--with-all]
//                         [--with-companion-skills]
//
// Padrões: --claude-dir = ~/.claude, --skills-dir = ~/.agents/skills,
// --alias = muri-saver (nome padrão inteligente).
// Detecta o SO sozinho (darwin/linux/win32) via os.homedir()/process.platform
// — os mesmos caminhos relativos à home funcionam nos três.
//
// O que este script NÃO faz (de propósito):
//   - Não instala o binário `ai-memory` nem roda `ai-memory install-hooks`
//     (isso é do instalador oficial do ai-memory, ver docs/ai-memory-obsidian-setup.md).
//   - Não instala o app Obsidian.
//   - Não sobrescreve um CLAUDE.md/GEMINI.md/AGENTS.md ou settings.json
//     existente sem avisar — sempre faz backup antes de tocar em algo que já existe.

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
    else if (a === '--codex-dir') args.codexDir = argv[++i];
    else if (a === '--gemini-dir') args.geminiDir = argv[++i];
    else if (a === '--vault') args.vault = argv[++i];
    else if (a === '--alias' || a === '--skill-name') args.alias = argv[++i];
    else if (a === '--author-name') args.authorName = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--skip-claude-md') args.skipClaudeMd = true;
    else if (a === '--with-codex') args.withCodex = true;
    else if (a === '--with-antigravity') args.withAntigravity = true;
    else if (a === '--with-all') { args.withCodex = true; args.withAntigravity = true; }
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

// Igual a copyFile, mas passa o conteúdo texto por `transform` antes de
// gravar (usado pra aplicar o alias personalizado em SKILL.md/CLAUDE.md/
// GEMINI.md/AGENTS.md sem tocar em arquivos binários).
function writeTransformedFile(src, dest, transform, dryRun) {
  log(`copiar ${src} -> ${dest}${transform ? ' (alias aplicado)' : ''}`);
  if (dryRun) return;
  ensureDir(dirname(dest), dryRun);
  const raw = readFileSync(src, 'utf8');
  writeFileSync(dest, transform ? transform(raw) : raw, 'utf8');
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

// --- Alias / custom branding -------------------------------------------
// Deixa qualquer dev (ou colega tipo Mendes, Lucas) clonar o repo e instalar
// com o próprio nome/alias em vez de "muri-saver", sem precisar editar nada
// manualmente. Padrão continua sendo estritamente "muri-saver" se --alias
// não for passado.

function sanitizeAlias(raw) {
  const slug = String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return slug || 'muri-saver';
}

function titleCaseWords(words) {
  return words.filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1));
}

// Faz um replace literal (nunca regex) das 4 formas de capitalização em que
// "muri-saver" aparece na prosa dos templates: "muri-saver", "muri saver",
// "Muri-Saver", "Muri Saver". Isso renomeia a skill e todos os gatilhos por
// igual, em todo o arquivo, sem precisar de um sistema de {{tokens}}
// separado nem de caçar cada ocorrência manualmente.
function applyAliasForms(content, alias) {
  if (alias === 'muri-saver') return content;
  const parts = alias.split('-');
  const spaced = parts.join(' ');
  const titleDashed = titleCaseWords(parts).join('-');
  const titleSpaced = titleCaseWords(parts).join(' ');

  return content
    .split('Muri-Saver').join(titleDashed)
    .split('Muri Saver').join(titleSpaced)
    .split('muri-saver').join(alias)
    .split('muri saver').join(spaced);
}

// Mantém "muri-saver" mencionado como alias alternativo herdado (pedido
// explícito do usuário), logo após o frontmatter YAML (SKILL.md) ou logo
// depois do título H1 (CLAUDE.md/GEMINI.md/AGENTS.md).
function injectAliasNote(content, alias) {
  const spaced = alias.split('-').join(' ');
  const note = `> **Alias personalizado:** instalado com o alias \`${alias}\`. Gatilhos: "${spaced}", ` +
    `"${alias}", "/${alias}" — e "muri-saver"/"muri saver"/"/muri-saver" continuam funcionando como ` +
    `alias alternativo herdado do padrão original do projeto.\n`;

  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n/);
  if (fmMatch) {
    const idx = fmMatch[0].length;
    return `${content.slice(0, idx)}\n${note}${content.slice(idx)}`;
  }
  const firstLineEnd = content.indexOf('\n');
  if (firstLineEnd === -1) return `${content}\n\n${note}`;
  return `${content.slice(0, firstLineEnd + 1)}\n${note}${content.slice(firstLineEnd + 1)}`;
}

function renderWithAlias(content, alias) {
  if (alias === 'muri-saver') return content;
  return injectAliasNote(applyAliasForms(content, alias), alias);
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

// Igual a mergeHooks, mas pro formato de dois níveis do hooks.json do
// Antigravity: { "<grupo>": { "<Evento>": [...] } } em vez do formato
// { "<Evento>": [{ matcher, hooks: [...] }] } do Claude Code.
function mergeAntigravityHooks(existing, snippetGroups) {
  const result = { ...(existing || {}) };
  for (const [group, events] of Object.entries(snippetGroups)) {
    if (group.startsWith('_comment') || group.startsWith('_nota')) continue;
    if (!events || typeof events !== 'object' || Array.isArray(events)) continue;
    const currentGroup = { ...(result[group] || {}) };
    for (const [event, entries] of Object.entries(events)) {
      const current = Array.isArray(currentGroup[event]) ? currentGroup[event] : [];
      const currentSerialized = current.map((e) => JSON.stringify(e));
      const toAdd = entries.filter((e) => !currentSerialized.includes(JSON.stringify(e)));
      currentGroup[event] = [...current, ...toAdd];
    }
    result[group] = currentGroup;
  }
  return result;
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
// de que o usuário tem o Codex instalado) ou se --with-codex/--with-all for
// passado.
function installCodexSupport(home, codexDirOverride, dryRun, force, alias) {
  const codexDir = codexDirOverride || join(home, '.codex');
  if (!force && !existsSync(codexDir)) {
    log('~/.codex não encontrado — pulando suporte a Codex (use --with-codex ou --with-all pra forçar).');
    return;
  }

  const hookSrc = join(REPO_ROOT, 'hooks', 'codex', 'obsidian-codex-session.mjs');
  const hookDest = join(codexDir, 'hooks', 'obsidian-codex-session.mjs');
  copyFile(hookSrc, hookDest, dryRun);

  const agentsDest = join(codexDir, 'AGENTS.md');
  if (existsSync(agentsDest)) {
    log(`AVISO: ${agentsDest} já existe — NÃO sobrescrevi. Compare com codex-config/AGENTS.md.template e mescle manualmente o que quiser adotar.`);
  } else {
    writeTransformedFile(join(REPO_ROOT, 'codex-config', 'AGENTS.md.template'), agentsDest, (c) => renderWithAlias(c, alias), dryRun);
  }

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

// Antigravity (Google AGY / Gemini) é opcional: só mexemos em ~/.gemini se a
// pasta já existir (sinal de que o Antigravity está instalado) ou se
// --with-antigravity/--with-all for passado. Reaproveita o MESMO
// hooks/obsidian-vault-check.mjs já copiado pro Claude Code (ele já detecta
// Antigravity via input.conversationId) — não duplicamos o script.
function installAntigravitySupport(home, geminiDirOverride, skillsDirOverride, dryRun, force, alias) {
  const geminiDir = geminiDirOverride || join(home, '.gemini');
  if (!force && !existsSync(geminiDir)) {
    log('~/.gemini não encontrado — pulando suporte a Antigravity (use --with-antigravity ou --with-all pra forçar).');
    return;
  }

  const geminiSkillsDir = skillsDirOverride || join(geminiDir, 'config', 'skills');
  writeTransformedFile(
    join(REPO_ROOT, 'skills', 'muri-saver', 'SKILL.md'),
    join(geminiSkillsDir, alias, 'SKILL.md'),
    (c) => renderWithAlias(c, alias),
    dryRun,
  );
  copyFile(join(REPO_ROOT, 'skills', 'grill-me', 'SKILL.md'), join(geminiSkillsDir, 'grill-me', 'SKILL.md'), dryRun);

  const geminiMdDest = join(geminiDir, 'GEMINI.md');
  if (existsSync(geminiMdDest)) {
    log(`AVISO: ${geminiMdDest} já existe — NÃO sobrescrevi. Compare com antigravity-config/GEMINI.md.template e mescle manualmente o que quiser adotar.`);
  } else {
    writeTransformedFile(join(REPO_ROOT, 'antigravity-config', 'GEMINI.md.template'), geminiMdDest, (c) => renderWithAlias(c, alias), dryRun);
  }

  const snippetPath = join(REPO_ROOT, 'antigravity-config', 'hooks.snippet.json');
  const snippet = readJsonSafe(snippetPath);
  if (!snippet) {
    log('AVISO: não consegui ler antigravity-config/hooks.snippet.json, pulando merge de ~/.gemini/config/hooks.json.');
    return;
  }
  const resolvedSnippet = JSON.parse(JSON.stringify(snippet).replaceAll('<HOME>', home));

  const hooksJsonPath = join(geminiDir, 'config', 'hooks.json');
  const existing = readJsonSafe(hooksJsonPath) || {};
  const result = mergeAntigravityHooks(existing, resolvedSnippet);

  backupIfExists(hooksJsonPath, dryRun);
  log(`gravar ${hooksJsonPath} (hook Stop do muri-saver pro Antigravity mesclado)`);
  if (!dryRun) {
    ensureDir(join(geminiDir, 'config'), dryRun);
    writeFileSync(hooksJsonPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  }
}

function installClaudeMd(claudeDir, dryRun, skip, alias) {
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
  writeTransformedFile(src, dest, (c) => renderWithAlias(c, alias), dryRun);
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
//
// Nota sobre grill-with-docs: NÃO é um substituto de `skills/grill-me/`
// (vendorizada, sempre copiada acima, independente desta lista) — as duas
// são usadas juntas. `grill-me` é o padrão do dia a dia; `grill-with-docs`
// é o upgrade opcional pra quando a entrevista precisa virar ADR/glossário
// permanente. Ver docs/skills-companion.md para a comparação completa.
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
    join('antigravity', 'sessions'),
    join('codex', 'sessions'),
    join('codex', 'dailies'),
    join('overview'),
    join('projects'),
  ];
  for (const d of dirs) {
    ensureDir(join(vaultPath, d), dryRun);
  }
  log(`vault escaneado em ${vaultPath} (dailies/, claude/sessions/, antigravity/sessions/, codex/sessions/, overview/, projects/)`);
  log('Lembre de trocar <CAMINHO_DO_SEU_VAULT> em mcp/mcp-servers.example.json por este caminho ao configurar o MCP do Obsidian.');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 24).join('\n'));
    return;
  }

  const home = os.homedir();
  const claudeDir = args.claudeDir || join(home, '.claude');
  const skillsDir = args.skillsDir || join(home, '.agents', 'skills');
  const dryRun = args.dryRun;
  const alias = sanitizeAlias(args.alias);
  const authorName = args.authorName ? String(args.authorName).trim() : null;

  log(`SO detectado: ${platformLabel(process.platform)} (${process.platform}/${process.arch}) — home: ${home}`);
  if (dryRun) log('MODO --dry-run: nada será escrito, só mostrando o que faria.');
  if (alias !== 'muri-saver') {
    log(`Alias personalizado ativo: "${alias}"${authorName ? ` (autor: ${authorName})` : ''} — skill e templates de governança serão renomeados, mantendo "muri-saver" como alias alternativo.`);
  }

  // 1. Skills próprias (100% originais, ver docs/skills-companion.md pras de terceiros).
  // Só a skill "muri-saver" é renomeada pelo alias — "grill-me" é uma skill
  // separada e nunca é afetada.
  writeTransformedFile(
    join(REPO_ROOT, 'skills', 'muri-saver', 'SKILL.md'),
    join(skillsDir, alias, 'SKILL.md'),
    (c) => renderWithAlias(c, alias),
    dryRun,
  );
  copyFile(join(REPO_ROOT, 'skills', 'grill-me', 'SKILL.md'), join(skillsDir, 'grill-me', 'SKILL.md'), dryRun);

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
  installClaudeMd(claudeDir, dryRun, args.skipClaudeMd, alias);

  // 6. Vault (opcional)
  scaffoldVault(args.vault, dryRun);

  // 7. Codex (opcional — só se detectado ou forçado via --with-codex/--with-all)
  installCodexSupport(home, args.codexDir, dryRun, args.withCodex, alias);

  // 8. Antigravity (opcional — só se detectado ou forçado via --with-antigravity/--with-all)
  installAntigravitySupport(home, args.geminiDir, null, dryRun, args.withAntigravity, alias);

  // 9. Skills companheiras de terceiros (opcional, ver docs/skills-companion.md)
  if (args.withCompanionSkills) installCompanionSkills(dryRun);

  log('Pronto. Próximos passos manuais (ver INSTALL-AI.md para o passo a passo completo):');
  log('  1. Instalar o binário ai-memory e rodar `ai-memory install-hooks --client claude-code`.');
  log('  2. Mesclar mcp/mcp-servers.example.json em ~/.claude.json (ou config do seu client) com o caminho real do seu vault.');
  log('  3. Reiniciar o Claude Code (e Antigravity/Codex, se instalados) pra carregar a skill, os hooks e o CLAUDE.md/GEMINI.md/AGENTS.md novos.');
  log('  4. Rodar `node bin/doctor.mjs` pra verificar tudo automaticamente (Node/Python/Claude CLI/ai-memory/MCP/Obsidian/vault/alias).');
  log('  5. Opcional: rodar `node bin/ingest-sessions.mjs --all --dry-run` pra ver o que seria importado das sessões antigas de cada agente pro Obsidian/ai-memory.');
}

main();
