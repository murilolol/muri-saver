#!/usr/bin/env node
// Verificação de ambiente pro muri-saver: 100% leitura, não escreve nada em
// lugar nenhum. Detecta o SO e adapta os caminhos que checa (macOS, Linux,
// Windows). Feito pra uma IA rodar sozinha depois do install.mjs e decidir
// sozinha o que falta, sem precisar perguntar pro usuário item por item.
//
// Uso:
//   node doctor.mjs [--vault <caminho-do-obsidian-vault>]
//
// Saída: uma linha por checagem (OK / AVISO / FALHA), e no final um resumo.
// Sai com código 1 se alguma checagem crítica falhar, 0 caso contrário —
// útil se você quiser usar isto num script maior.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PLATFORM = process.platform; // 'darwin' | 'linux' | 'win32'
const HOME = os.homedir();
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // bin/doctor.mjs -> raiz do repo

let failures = 0;
let warnings = 0;

function ok(label, detail) {
  console.log(`  OK    ${label}${detail ? ` — ${detail}` : ''}`);
}
function warn(label, detail) {
  warnings++;
  console.log(`  AVISO ${label}${detail ? ` — ${detail}` : ''}`);
}
function fail(label, detail) {
  failures++;
  console.log(`  FALHA ${label}${detail ? ` — ${detail}` : ''}`);
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function fileContains(path, needle) {
  try {
    return readFileSync(path, 'utf8').includes(needle);
  } catch {
    return false;
  }
}

// Acha a skill muri-saver mesmo se instalada sob um alias custom (--alias no
// install.mjs renomeia a pasta e o frontmatter `name:`) — procura pelo texto
// distintivo do corpo da skill em vez de assumir o nome literal da pasta.
function detectAlias(skillsDir) {
  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const e of entries) {
      const p = join(skillsDir, e.name, 'SKILL.md');
      if (fileContains(p, 'Modo de economia agressiva')) return e.name;
    }
  } catch {
    // pasta de skills não existe ainda
  }
  return null;
}

// Conta arquivos (recursivo, limitado) pra dar um sinal de "tem sessões aqui"
// sem precisar ler o conteúdo de cada uma.
function countFilesRecursive(dir, matcher, maxDepth = 4, maxFiles = 200) {
  let count = 0;
  const stack = [{ d: dir, depth: 0 }];
  while (stack.length && count < maxFiles) {
    const { d, depth } = stack.pop();
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth) stack.push({ d: full, depth: depth + 1 });
      } else if (!matcher || matcher(e.name)) {
        count++;
      }
    }
  }
  return count;
}

function cmdExists(cmd, versionFlag = '--version') {
  try {
    execSync(`${cmd} ${versionFlag}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function tcpUp(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

function platformLabel() {
  if (PLATFORM === 'darwin') return 'macOS';
  if (PLATFORM === 'win32') return 'Windows';
  if (PLATFORM === 'linux') return 'Linux';
  return PLATFORM;
}

async function main() {
  const args = process.argv.slice(2);
  const vaultIdx = args.indexOf('--vault');
  const vaultArg = vaultIdx >= 0 ? args[vaultIdx + 1] : null;
  const vaultPath = vaultArg || join(HOME, 'Documents', 'Obsidian Vault');

  console.log(`muri-saver doctor — SO detectado: ${platformLabel()} (${PLATFORM}/${os.arch()})`);

  section('Runtimes');
  if (cmdExists('node', '--version')) ok('Node.js', execSync('node --version').toString().trim());
  else fail('Node.js não encontrado no PATH', 'necessário pros hooks (.mjs) e pro install.mjs/doctor.mjs');

  if (cmdExists('python3', '--version')) ok('Python 3', execSync('python3 --version').toString().trim());
  else if (cmdExists('python', '--version')) warn('Python 3 não encontrado como "python3"', 'encontrado como "python" — ajuste statusLine/comandos se necessário (comum no Windows)');
  else fail('Python 3 não encontrado no PATH', 'necessário pra usage-status.py e statusline.py');

  if (cmdExists('claude', '--version')) ok('Claude Code CLI', execSync('claude --version').toString().trim());
  else warn('Claude Code CLI não encontrado no PATH', 'pode estar instalado só pro app desktop — confirme com o usuário');

  section('ai-memory');
  const aiMemoryBinCandidates = PLATFORM === 'win32'
    ? [join(HOME, '.cargo', 'bin', 'ai-memory.exe')]
    : [join(HOME, '.local', 'bin', 'ai-memory')];
  const aiMemoryBinFound = aiMemoryBinCandidates.find(existsSync);
  if (aiMemoryBinFound) ok('binário ai-memory', aiMemoryBinFound);
  else if (cmdExists('ai-memory', '--version')) ok('binário ai-memory', 'encontrado no PATH');
  else fail('binário ai-memory não encontrado', `esperado em ${aiMemoryBinCandidates.join(' ou ')}, nem no PATH — ver docs/ai-memory-obsidian-setup.md`);

  const serverUp = await tcpUp('127.0.0.1', 49374);
  if (serverUp) ok('servidor ai-memory respondendo', 'http://127.0.0.1:49374');
  else warn('servidor ai-memory não está de pé agora', 'normal se nenhuma sessão do Claude Code rodou ainda — o hook SessionStart sobe sozinho');

  section('Config do Claude Code');
  const claudeDir = join(HOME, '.claude');
  const settingsPath = join(claudeDir, 'settings.json');
  const settings = readJsonSafe(settingsPath);
  if (!settings) {
    fail(`${settingsPath} não encontrado ou inválido`);
  } else {
    const hooksStop = settings.hooks?.Stop || [];
    const hooksStart = settings.hooks?.SessionStart || [];
    const hasVaultHook = JSON.stringify(hooksStop).includes('obsidian-vault-check.mjs');
    const hasEnsureServerHook = JSON.stringify(hooksStart).includes('ai-memory-ensure-server.mjs');
    if (hasVaultHook) ok('hook Stop (obsidian-vault-check.mjs) registrado em settings.json');
    else fail('hook Stop (obsidian-vault-check.mjs) NÃO está em settings.json', 'rode node install.mjs, ou mescle claude-config/settings.snippet.json manualmente');
    if (hasEnsureServerHook) ok('hook SessionStart (ai-memory-ensure-server.mjs) registrado em settings.json');
    else fail('hook SessionStart (ai-memory-ensure-server.mjs) NÃO está em settings.json');

    const enabledPlugins = settings.enabledPlugins || {};
    const pluginKeys = Object.keys(enabledPlugins);
    // Prioriza especificamente o plugin "claude-obsidian" (AgriciDaniel) — não
    // confundir com outros plugins que também têm "obsidian" no nome, como o
    // "obsidian-skills" (kepano), que é um marketplace diferente e não é
    // requisito deste setup.
    const claudeObsidianKey = pluginKeys.find((k) => k.toLowerCase().includes('claude-obsidian'));
    const anyObsidianKey = pluginKeys.find((k) => k.toLowerCase().includes('obsidian'));
    const pluginKey = claudeObsidianKey || anyObsidianKey;
    if (claudeObsidianKey && enabledPlugins[claudeObsidianKey]) {
      ok('plugin claude-obsidian habilitado', claudeObsidianKey);
    } else if (pluginKey) {
      warn('plugin claude-obsidian não está habilitado', `${pluginKey}: ${enabledPlugins[pluginKey]} — habilite em /plugin ou settings.json se quiser usar (procure especificamente por "claude-obsidian@..."; outros plugins com "obsidian" no nome são marketplaces diferentes)`);
    } else {
      warn('plugin claude-obsidian não encontrado em enabledPlugins', 'opcional — só necessário se você quiser os comandos /wiki, /save etc. Ver claude-obsidian@AgriciDaniel no marketplace (/plugin marketplace add AgriciDaniel/claude-obsidian)');
    }
  }

  if (existsSync(join(claudeDir, 'hooks', 'obsidian-vault-check.mjs'))) ok('arquivo hooks/obsidian-vault-check.mjs presente em ~/.claude/hooks');
  else fail('~/.claude/hooks/obsidian-vault-check.mjs não encontrado');

  if (existsSync(join(claudeDir, 'hooks', 'ai-memory-ensure-server.mjs'))) ok('arquivo hooks/ai-memory-ensure-server.mjs presente em ~/.claude/hooks');
  else fail('~/.claude/hooks/ai-memory-ensure-server.mjs não encontrado');

  const skillsDir = join(HOME, '.agents', 'skills');
  const detectedAlias = detectAlias(skillsDir);
  if (detectedAlias && detectedAlias === 'muri-saver') ok('skill muri-saver instalada em ~/.agents/skills (alias padrão)');
  else if (detectedAlias) ok(`skill muri-saver instalada em ~/.agents/skills sob alias customizado "${detectedAlias}"`, 'muri-saver/muri saver continuam funcionando como alias alternativo');
  else fail('nenhuma skill muri-saver (padrão ou alias customizado) encontrada em ~/.agents/skills', 'rode node install.mjs [--alias <nome>]');

  if (existsSync(join(claudeDir, 'CLAUDE.md'))) ok('~/.claude/CLAUDE.md existe');
  else warn('~/.claude/CLAUDE.md não existe ainda', 'rode node install.mjs (ele cria a partir do template se não existir)');

  section('MCP servers');
  const claudeJsonPath = join(HOME, '.claude.json');
  const claudeJson = readJsonSafe(claudeJsonPath);
  if (!claudeJson) {
    warn(`${claudeJsonPath} não encontrado`, 'normal se o Claude Code nunca rodou nesta máquina ainda');
  } else {
    const mcp = claudeJson.mcpServers || {};
    if (mcp['ai-memory']) ok('MCP "ai-memory" registrado em ~/.claude.json');
    else fail('MCP "ai-memory" NÃO registrado', 'mescle mcp/mcp-servers.example.json em ~/.claude.json → mcpServers');
    if (mcp['obsidian']) ok('MCP "obsidian" (@bitbonsai/mcpvault) registrado em ~/.claude.json');
    else warn('MCP "obsidian" NÃO registrado', 'opcional mas recomendado — mescle mcp/mcp-servers.example.json');
  }

  section('Obsidian (app)');
  const obsidianAppCandidates = {
    darwin: ['/Applications/Obsidian.app'],
    win32: [
      join(HOME, 'AppData', 'Local', 'Obsidian', 'Obsidian.exe'),
      'C:\\Program Files\\Obsidian\\Obsidian.exe',
    ],
    linux: ['/usr/bin/obsidian', '/opt/Obsidian/obsidian', join(HOME, '.local', 'share', 'flatpak', 'app', 'md.obsidian.Obsidian')],
  }[PLATFORM] || [];
  const obsidianFound = obsidianAppCandidates.find(existsSync);
  if (obsidianFound) ok('app Obsidian encontrado', obsidianFound);
  else warn('app Obsidian não encontrado nos caminhos comuns', `baixe em https://obsidian.md — checados: ${obsidianAppCandidates.join(', ') || '(nenhum caminho conhecido pra este SO)'}`);

  section('Vault');
  if (existsSync(vaultPath)) {
    ok('pasta do vault existe', vaultPath);
    for (const sub of ['dailies', join('claude', 'sessions'), join('antigravity', 'sessions'), join('codex', 'sessions'), 'overview', 'projects']) {
      const p = join(vaultPath, sub);
      if (existsSync(p)) ok(`  vault/${sub}`);
      else warn(`  vault/${sub} não existe ainda`, 'roda node install.mjs --vault "<caminho>" pra criar');
    }
  } else {
    warn('pasta do vault não encontrada', `${vaultPath} — passe --vault "<caminho>" se o seu vault estiver em outro lugar`);
  }

  section('Multi-agente — governança e sessões brutas de cada IA');
  // Claude Code
  const claudeProjectsDir = join(HOME, '.claude', 'projects');
  if (existsSync(claudeProjectsDir)) {
    const n = countFilesRecursive(claudeProjectsDir, (f) => f.endsWith('.jsonl'));
    ok('sessões brutas do Claude Code encontradas', `~/.claude/projects (${n}${n >= 200 ? '+' : ''} arquivo(s) .jsonl)`);
  } else {
    warn('~/.claude/projects não encontrado', 'normal se o Claude Code nunca rodou nesta máquina ainda');
  }

  // Antigravity / Gemini CLI
  const geminiDir = join(HOME, '.gemini');
  const antigravityBrainDir = join(geminiDir, 'antigravity-cli', 'brain');
  if (existsSync(antigravityBrainDir)) {
    const n = countFilesRecursive(antigravityBrainDir, (f) => f === 'transcript_full.jsonl' || f === 'transcript.jsonl');
    ok('sessões brutas do Antigravity encontradas', `~/.gemini/antigravity-cli/brain (${n}${n >= 200 ? '+' : ''} transcript(s))`);
  } else {
    warn('~/.gemini/antigravity-cli/brain não encontrado', 'normal se o Antigravity nunca rodou nesta máquina, ou se --with-antigravity ainda não foi usado');
  }
  if (existsSync(join(geminiDir, 'GEMINI.md'))) ok('~/.gemini/GEMINI.md existe (governança Antigravity instalada)');
  else warn('~/.gemini/GEMINI.md não existe ainda', 'rode node install.mjs --with-antigravity (ele cria a partir do template se não existir)');

  // Codex
  const codexSessionsDir = join(HOME, '.codex', 'sessions');
  const codexSqliteCandidates = [join(HOME, '.codex', 'thread_history_1.sqlite')];
  if (existsSync(codexSessionsDir)) {
    const n = countFilesRecursive(codexSessionsDir, (f) => f.endsWith('.jsonl'));
    ok('sessões brutas do Codex encontradas', `~/.codex/sessions (${n}${n >= 200 ? '+' : ''} rollout(s) .jsonl)`);
  } else if (codexSqliteCandidates.some(existsSync)) {
    ok('histórico do Codex encontrado', 'via SQLite (thread_history_1.sqlite)');
  } else {
    warn('~/.codex/sessions não encontrado', 'normal se o Codex CLI nunca rodou nesta máquina, ou se --with-codex ainda não foi usado');
  }
  if (existsSync(join(HOME, '.codex', 'AGENTS.md'))) ok('~/.codex/AGENTS.md existe (governança Codex instalada)');
  else warn('~/.codex/AGENTS.md não existe ainda', 'rode node install.mjs --with-codex (ele cria a partir do template se não existir)');

  section('Ingestor de sessões (bin/ingest-sessions.mjs)');
  const ingestorPath = join(REPO_ROOT, 'bin', 'ingest-sessions.mjs');
  if (existsSync(ingestorPath)) {
    ok('bin/ingest-sessions.mjs presente neste repositório');
    console.log('        Sugestão: node bin/ingest-sessions.mjs --all --dry-run   (simulação, não escreve nada)');
  } else {
    warn('bin/ingest-sessions.mjs não encontrado neste checkout', 'confirme que você está rodando o doctor a partir da raiz do repositório muri-saver');
  }

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`Resumo: ${failures} falha(s), ${warnings} aviso(s).`);
  if (failures === 0 && warnings === 0) console.log('Tudo certo — instalação completa.');
  else if (failures === 0) console.log('Instalação funcional, mas com itens opcionais pendentes (ver AVISOs acima).');
  else console.log('Existem FALHAs que impedem o funcionamento completo — ver INSTALL-AI.md pra corrigir cada uma.');

  process.exit(failures > 0 ? 1 : 0);
}

main();
