#!/usr/bin/env node
// Ingestor & exportador de sessões multi-agente do muri-saver.
//
// Varre as sessões antigas já existentes na máquina (Claude Code, Antigravity/
// Gemini CLI, Codex CLI, e exports avulsos do Claude Desktop/Web) e grava um
// registro leve — sem chamar nenhuma LLM — no Obsidian Vault e/ou no
// `ai-memory`, ou exporta pra uma pasta de Markdown/JSON solta. Reaproveita as
// mesmas convenções de pasta e o mesmo estilo de "dump bruto" que os hooks
// deste repositório (`hooks/obsidian-vault-check.mjs`,
// `hooks/codex/obsidian-codex-session.mjs`) já usam pra sessões triviais —
// de propósito: uma varredura retroativa de possivelmente milhares de sessões
// NÃO deve chamar `claude -p` (ou qualquer LLM) por sessão, isso custaria uma
// fortuna e vai contra a filosofia de economia do próprio projeto.
//
// 100% Node.js ESM, zero dependências externas, Node >= 18. Sem `sqlite3`
// nem nenhum parser binário — onde o formato de origem é SQLite (Codex,
// opcionalmente), o script detecta o arquivo e avisa em vez de tentar ler o
// formato binário sem uma lib.
//
// Uso:
//   node bin/ingest-sessions.mjs --all --dry-run
//   node bin/ingest-sessions.mjs --agent claude --limit 20
//   node bin/ingest-sessions.mjs --agent antigravity --since 2026-09-01
//   node bin/ingest-sessions.mjs --file ./conversations.json --export-dir ./out
//
// Ver docs/session-ingestor.md pro formato de cada fonte e detalhes de
// sanitização/idempotência.

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, statSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HOME = os.homedir();
const PLATFORM = process.platform;
const CACHE_PATH = join(HOME, '.claude', 'cache', '.muri-saver-ingested.json');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    all: false, agents: [], dryRun: false, limit: null, since: null,
    vault: null, skipAiMemory: false, skipVault: false, exportDir: null,
    file: null, force: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') args.all = true;
    else if (a === '--agent') args.agents.push(...String(argv[++i]).split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') args.limit = Number(argv[++i]) || null;
    else if (a === '--since') args.since = argv[++i];
    else if (a === '--vault') args.vault = argv[++i];
    else if (a === '--skip-ai-memory') args.skipAiMemory = true;
    else if (a === '--skip-vault') args.skipVault = true;
    else if (a === '--export-dir') args.exportDir = argv[++i];
    else if (a === '--file') args.file = argv[++i];
    else if (a === '--force') args.force = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

const HELP = `
Uso: node bin/ingest-sessions.mjs [opções]

  --all                       Varre todos os agentes detectados na máquina.
  --agent <nome[,nome2,...]>  Filtra por agente(s): claude | antigravity | codex | desktop.
  --dry-run                   Simulação: lista sessões e contagens, não escreve nada.
  --limit <N>                 Limita às N sessões mais recentes por agente (padrão: sem limite).
  --since <YYYY-MM-DD>        Só sessões a partir dessa data.
  --vault <caminho>           Caminho do Obsidian Vault (padrão: ~/Documents/Obsidian Vault).
  --skip-ai-memory            Não grava no ai-memory.
  --skip-vault                Não grava no Obsidian.
  --export-dir <caminho>      Exporta Markdown/JSON avulsos pra essa pasta (não precisa de vault/ai-memory).
  --file <caminho>            Processa um arquivo exportado avulso (ex: conversations.json do Claude Desktop/Web).
  --force                     Reimporta mesmo se já estiver no cache de idempotência.
  --help                      Mostra esta ajuda.

Exemplos:
  node bin/ingest-sessions.mjs --all --dry-run
  node bin/ingest-sessions.mjs --agent claude --limit 20
  node bin/ingest-sessions.mjs --agent antigravity --since 2026-09-01
  node bin/ingest-sessions.mjs --file ./conversations.json --export-dir ./out --skip-vault --skip-ai-memory
`;

function log(msg) {
  console.log(`[ingest-sessions] ${msg}`);
}

// ---------------------------------------------------------------------------
// Utilidades gerais
// ---------------------------------------------------------------------------

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function brDateParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { date: `${v.year}-${v.month}-${v.day}`, time: `${v.hour}h${v.minute}` };
}

function shortId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'local';
}

function walkFiles(root, matcher, maxDepth = 6) {
  const out = [];
  const stack = [{ d: root, depth: 0 }];
  while (stack.length) {
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
      } else if (!matcher || matcher(e.name, full)) {
        out.push(full);
      }
    }
  }
  return out;
}

function readLinesJson(path, maxBytes = 60 * 1024 * 1024) {
  try {
    const st = statSync(path);
    if (st.size > maxBytes) return { objects: null, tooLarge: true, size: st.size };
    const raw = readFileSync(path, 'utf8');
    const objects = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { objects.push(JSON.parse(line)); } catch { /* ignora linha inválida */ }
    }
    return { objects, tooLarge: false, size: st.size };
  } catch {
    return { objects: [], tooLarge: false, size: 0 };
  }
}

// ---------------------------------------------------------------------------
// Sanitização (Regra de Ouro do CLAUDE.md/GEMINI.md/AGENTS.md — seção 10/9)
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  { re: /sk-ant-[A-Za-z0-9_-]{10,}/g, label: 'ANTHROPIC_KEY' },
  { re: /sk-proj-[A-Za-z0-9_-]{10,}/g, label: 'OPENAI_PROJECT_KEY' },
  { re: /\bsk-[A-Za-z0-9]{20,}\b/g, label: 'API_KEY' },
  { re: /gh[pousr]_[A-Za-z0-9]{20,}/g, label: 'GITHUB_TOKEN' },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/g, label: 'SLACK_TOKEN' },
  { re: /AKIA[0-9A-Z]{16}/g, label: 'AWS_ACCESS_KEY_ID' },
  { re: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/g, label: 'AWS_SECRET_ACCESS_KEY' },
  { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, label: 'JWT' },
  { re: /Bearer\s+[A-Za-z0-9._-]{20,}/g, label: 'BEARER_TOKEN' },
  { re: /(?:senha|password|passwd)\s*[:=]\s*['"]?\S{6,}['"]?/gi, label: 'PASSWORD' },
];

function maskSecrets(text) {
  if (!text) return text;
  let out = String(text);
  for (const { re, label } of SECRET_PATTERNS) {
    out = out.replace(re, `***REDACTED-${label}***`);
  }
  return out;
}

// Tags de sistema/IDE que nunca podem sobreviver na nota final (mantém o
// texto interno, remove só o marcador). Cobre o que a Regra de Ouro do
// CLAUDE.md/GEMINI.md/AGENTS.md pede explicitamente.
const SYSTEM_TAGS_RE = /<\/?(?:USER_REQUEST|ADDITIONAL_METADATA|CONTEXT_SUMMARY|SYSTEM_MESSAGE|PLAN|local-command-caveat|local-command-stdout|command-name|command-message|command-args)>/g;

function stripSystemTags(text) {
  if (!text) return text;
  return String(text).replace(SYSTEM_TAGS_RE, '');
}

// Escapa qualquer outra tag HTML/JSX/SVG solta em inline-code — mesma técnica
// já usada em produção por hooks/obsidian-vault-check.mjs, pra nunca deixar
// uma tag desbalanceada (`<div>`, `<button>`) engolir o resto da nota no
// Obsidian.
function escapeStrayHtml(text) {
  if (!text) return '';
  return String(text).replace(/<\/?[a-zA-Z][^>]*>/g, (m) => `\`${m}\``);
}

function sanitize(text) {
  return escapeStrayHtml(stripSystemTags(maskSecrets(text)));
}

// ---------------------------------------------------------------------------
// Idempotência
// ---------------------------------------------------------------------------

function loadCache() {
  return readJsonSafe(CACHE_PATH) || { version: 1, entries: {} };
}

function saveCache(cache) {
  ensureDir(dirname(CACHE_PATH));
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf8');
}

function cacheKey(agent, id) {
  return `${agent}:${id}`;
}

function fingerprintFile(path) {
  try {
    const st = statSync(path);
    return `${st.size}:${Math.floor(st.mtimeMs)}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Descoberta + parsing por agente
// ---------------------------------------------------------------------------

// Cada "ref" normalizado: { agent, id, idShort, label, sourcePaths[], mtimeMs }
// O parsing pesado só roda quando a sessão realmente vai ser processada (não
// em --dry-run, que só lê metadados baratos: tamanho, mtime, contagem de
// linhas).

function discoverClaude() {
  const projectsDir = join(HOME, '.claude', 'projects');
  if (!existsSync(projectsDir)) return [];
  const files = walkFiles(projectsDir, (name) => name.endsWith('.jsonl'), 2);
  return files.map((full) => {
    const id = basename(full, '.jsonl');
    let mtimeMs = 0;
    try { mtimeMs = statSync(full).mtimeMs; } catch { /* ignore */ }
    return { agent: 'claude', id, idShort: shortId(id), sourcePaths: [full], mtimeMs };
  });
}

function parseClaudeSession(ref) {
  const { objects, tooLarge } = readLinesJson(ref.sourcePaths[0]);
  if (tooLarge || !objects) return { exchanges: [], cwd: null, toolCallCount: 0, startedAt: null };
  const exchanges = [];
  let cwd = null;
  let toolCallCount = 0;
  let startedAt = null;
  for (const obj of objects) {
    if (obj.cwd && !cwd) cwd = obj.cwd;
    if (obj.timestamp && !startedAt) startedAt = obj.timestamp;
    if (obj.isSidechain || obj.isMeta) continue;
    const role = obj.type;
    if (role !== 'user' && role !== 'assistant') continue;
    const content = obj.message?.content ?? obj.content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      for (const c of content) {
        if (c?.type === 'text' && c.text) text += (text ? '\n' : '') + c.text;
        else if (c?.type === 'tool_use') toolCallCount++;
      }
    }
    if (!text) continue;
    if (text.startsWith('<command-name>') || text.startsWith('<local-command-stdout>') || text.includes('<local-command-caveat>')) continue;
    exchanges.push({ role, text: text.trim(), ts: obj.timestamp || null });
  }
  return { exchanges, cwd, toolCallCount, startedAt };
}

function discoverAntigravity() {
  const brainDir = join(HOME, '.gemini', 'antigravity-cli', 'brain');
  if (!existsSync(brainDir)) return [];
  let convDirs = [];
  try {
    convDirs = readdirSync(brainDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const refs = [];
  for (const id of convDirs) {
    const logsDir = join(brainDir, id, '.system_generated', 'logs');
    const full = join(logsDir, 'transcript_full.jsonl');
    const fallback = join(logsDir, 'transcript.jsonl');
    const path = existsSync(full) ? full : (existsSync(fallback) ? fallback : null);
    if (!path) continue;
    let mtimeMs = 0;
    try { mtimeMs = statSync(path).mtimeMs; } catch { /* ignore */ }
    refs.push({ agent: 'antigravity', id, idShort: shortId(id), sourcePaths: [path], mtimeMs });
  }
  return refs;
}

function parseAntigravitySession(ref) {
  const { objects, tooLarge } = readLinesJson(ref.sourcePaths[0]);
  if (tooLarge || !objects) return { exchanges: [], cwd: null, toolCallCount: 0, startedAt: null };
  const exchanges = [];
  let toolCallCount = 0;
  let startedAt = null;
  let cwdHint = null;
  for (const obj of objects) {
    if (obj.created_at && !startedAt) startedAt = obj.created_at;
    if (Array.isArray(obj.tool_calls)) {
      toolCallCount += obj.tool_calls.length;
      if (!cwdHint) {
        for (const tc of obj.tool_calls) {
          const p = tc?.args?.TargetFile || tc?.args?.path || tc?.args?.cwd;
          if (typeof p === 'string' && p.includes('/')) { cwdHint = dirname(p); break; }
        }
      }
    }
    const type = obj.type;
    if (type === 'USER_INPUT') {
      if (typeof obj.content === 'string' && obj.content.trim()) {
        exchanges.push({ role: 'user', text: obj.content.trim(), ts: obj.created_at || null });
      }
    } else if (type === 'PLANNER_RESPONSE') {
      if (typeof obj.content === 'string' && obj.content.trim()) {
        exchanges.push({ role: 'assistant', text: obj.content.trim(), ts: obj.created_at || null });
      }
    }
  }
  return { exchanges, cwd: cwdHint, toolCallCount, startedAt };
}

function discoverCodex() {
  const sessionsDir = join(HOME, '.codex', 'sessions');
  const refs = [];
  if (existsSync(sessionsDir)) {
    const files = walkFiles(sessionsDir, (name) => name.startsWith('rollout-') && name.endsWith('.jsonl'), 4);
    for (const full of files) {
      const m = basename(full, '.jsonl').match(/rollout-.*-([0-9a-fA-F-]{8,})$/);
      const id = m ? m[1] : basename(full, '.jsonl');
      let mtimeMs = 0;
      try { mtimeMs = statSync(full).mtimeMs; } catch { /* ignore */ }
      refs.push({ agent: 'codex', id, idShort: shortId(id), sourcePaths: [full], mtimeMs });
    }
  }
  // SQLite (thread_history_1.sqlite etc.) — detectado mas não parseado: este
  // script é zero-dependência de propósito e não traz um parser binário de
  // SQLite. Reportado no --dry-run como aviso, não como sessão importável.
  return refs;
}

function discoverCodexSqliteFiles() {
  const codexDir = join(HOME, '.codex');
  if (!existsSync(codexDir)) return [];
  try {
    return readdirSync(codexDir).filter((f) => f.endsWith('.sqlite')).map((f) => join(codexDir, f));
  } catch {
    return [];
  }
}

function parseCodexSession(ref) {
  const { objects, tooLarge } = readLinesJson(ref.sourcePaths[0]);
  if (tooLarge || !objects) return { exchanges: [], cwd: null, toolCallCount: 0, startedAt: null };
  const exchanges = [];
  let toolCallCount = 0;
  let startedAt = null;
  let cwd = null;
  for (const obj of objects) {
    if (obj.type === 'session_meta') {
      cwd = cwd || obj.payload?.cwd || null;
      startedAt = startedAt || obj.payload?.timestamp || obj.timestamp || null;
      continue;
    }
    if (obj.type !== 'response_item') continue;
    const p = obj.payload || {};
    if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
      const content = Array.isArray(p.content) ? p.content : [];
      const text = content.map((c) => c?.text).filter(Boolean).join('\n').trim();
      if (text) exchanges.push({ role: p.role, text, ts: obj.timestamp || null });
    } else if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      toolCallCount++;
    }
  }
  return { exchanges, cwd, toolCallCount, startedAt };
}

// Claude Desktop/Web: export manual do usuário (Settings -> Export data),
// arquivo `conversations.json` com um array de conversas. O formato varia
// entre versões do export; o parser abaixo é best-effort e tolerante —
// nunca lança, ignora conversas que não reconhece.
function parseDesktopFile(path) {
  const raw = readJsonSafe(path);
  const conversations = Array.isArray(raw) ? raw : (Array.isArray(raw?.conversations) ? raw.conversations : []);
  const refs = [];
  for (const conv of conversations) {
    try {
      const id = conv.uuid || conv.id || conv.conversation_id || `desktop-${refs.length}`;
      const messages = conv.chat_messages || conv.messages || [];
      const exchanges = [];
      for (const m of messages) {
        const sender = m.sender || m.role || m.author;
        const role = /human|user/i.test(String(sender)) ? 'user' : 'assistant';
        let text = m.text || '';
        if (!text && Array.isArray(m.content)) {
          text = m.content.map((c) => c?.text).filter(Boolean).join('\n');
        }
        text = String(text || '').trim();
        if (text) exchanges.push({ role, text, ts: m.created_at || m.timestamp || null });
      }
      if (!exchanges.length) continue;
      refs.push({
        agent: 'desktop',
        id,
        idShort: shortId(id),
        sourcePaths: [path],
        mtimeMs: Date.parse(conv.created_at || conv.updated_at || '') || Date.now(),
        _preParsed: { exchanges, cwd: null, toolCallCount: 0, startedAt: conv.created_at || null, title: conv.name || null },
      });
    } catch {
      // conversa malformada — ignora e segue
    }
  }
  return refs;
}

function parseSession(ref) {
  if (ref._preParsed) return ref._preParsed;
  if (ref.agent === 'claude') return parseClaudeSession(ref);
  if (ref.agent === 'antigravity') return parseAntigravitySession(ref);
  if (ref.agent === 'codex') return parseCodexSession(ref);
  return { exchanges: [], cwd: null, toolCallCount: 0, startedAt: null };
}

// ---------------------------------------------------------------------------
// Markdown / vault
// ---------------------------------------------------------------------------

const AGENT_LABEL = { claude: 'Claude', antigravity: 'Antigravity', codex: 'Codex', desktop: 'Claude Desktop/Web' };
const AGENT_ICON = { claude: '🟧', antigravity: '🤖', codex: '🧩', desktop: '💻' };
const AGENT_FILE_TAG = { claude: 'Claude', antigravity: 'AGY', codex: 'Codex', desktop: 'Desktop' };

function projectLabelFromCwd(cwd) {
  if (!cwd) return null;
  const clean = String(cwd).replace(/[/\\]+$/, '');
  const b = basename(clean);
  return b || null;
}

// Frontmatter YAML do Obsidian quebra se um `title:` sem aspas contiver
// ":" seguido de espaço (interpretado como mapeamento aninhado) — real risco
// aqui porque o título vem do primeiro prompt do usuário (texto arbitrário),
// diferente dos títulos curados que os hooks ao vivo geram.
function yamlQuote(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

const MAX_DUMP_CHARS = 60000;

function buildExchangesBody(exchanges) {
  if (!exchanges.length) {
    return '_Nenhum prompt substantivo capturado nesta sessão._';
  }
  let body = exchanges
    .map((e) => `${e.role === 'user' ? '🧑 **Usuário**' : '🤖 **IA**'}\n\n${sanitize(e.text)}`)
    .join('\n\n---\n\n');
  if (body.length > MAX_DUMP_CHARS) {
    const headLen = Math.floor(MAX_DUMP_CHARS * 0.5);
    body = `${body.slice(0, headLen)}\n\n[... trecho intermediário omitido pelo ingestor ...]\n\n${body.slice(-(MAX_DUMP_CHARS - headLen))}`;
  }
  return body;
}

function buildSessionMarkdown({ agent, idShort, id, dateStr, timeStr, exchanges, toolCallCount, project, title }) {
  const agentLabel = AGENT_LABEL[agent];
  const icon = AGENT_ICON[agent];
  const firstUser = exchanges.find((e) => e.role === 'user');
  const titulo = sanitize((title || (firstUser ? firstUser.text.slice(0, 80) : 'Sessão importada'))).replace(/\n/g, ' ');
  const projectLine = project ? `- **Projeto detectado:** \`${sanitize(project)}\`\n` : '';

  return `---
title: ${yamlQuote(`Sessão ${agentLabel} ${idShort} (importada) — ${titulo}`)}
agent: ${agent}
date_start: ${dateStr}
session_id: ${idShort}
tier: episodic
status: concluded
generated: ingest-sessions
tags:
  - session
  - ${agent}
  - muri-saver
  - imported
---

# ${icon} Sessão ${agentLabel} ${idShort} (importada)

🏷️ **Tags:** #session #${agent} #muri-saver #imported

- **ID da Sessão:** \`${idShort}\` (\`${id}\`)
- **Agente:** ${agentLabel}
- **Data:** ${dateStr} às ${timeStr}
${projectLine}- **Comandos/tool calls detectados:** ${toolCallCount}
- **Importado por:** \`bin/ingest-sessions.mjs\` — sem chamada de LLM, extração 100% local.

---

## 💬 Prompts & Respostas (importado)

${buildExchangesBody(exchanges)}

---

## 🌐 Conexões Globais no Grafo
[[${agent}/README|Central ${agentLabel}]] [[dailies/Daily-${dateStr}|Diário de Bordo ${dateStr}]]
`;
}

function fileGlobExists(dirPath, idFragment) {
  try {
    return readdirSync(dirPath).some((f) => f.includes(idFragment));
  } catch {
    return false;
  }
}

function dailyEntryLine(agent, idShort, timeStr, exchanges, project) {
  const agentLabel = AGENT_LABEL[agent];
  const firstUser = exchanges.find((e) => e.role === 'user');
  const resumo = sanitize((firstUser ? firstUser.text.slice(0, 140) : 'Sessão importada sem prompts substantivos'));
  const projectNote = project ? ` _(projeto: ${sanitize(project)})_` : '';
  return `### [[${agent}/sessions/Session-PLACEHOLDER|Sessão ${agentLabel} ${idShort}]] (${timeStr}) 📥 _importado_\n- **Resumo:** ${resumo}${projectNote} _(importado retroativamente, sem custo de LLM)_`;
}

function appendDailyEntry(dailyPath, entryMarkdown, dateStr, agentLabel) {
  const skeleton = `---
title: Diário de Bordo — ${dateStr}
kind: fact
pinned: true
tier: episodic
tags:
  - daily
  - session
  - log
  - muri-saver
---

# 📅 Diário de Bordo — ${dateStr}

Registro cronológico de atividades. Gerado/mesclado automaticamente.

---

## 📋 Sessões do Dia

<!-- ENTRIES -->

---

## 🌐 Conexões Globais no Grafo
[[Hub-Projects|Central de Projetos]] [[Hub-Agents|Central de Agentes]]
`;
  if (!existsSync(dailyPath)) {
    ensureDir(dirname(dailyPath));
    writeFileSync(dailyPath, skeleton.replace('<!-- ENTRIES -->', entryMarkdown));
    return;
  }
  const content = readFileSync(dailyPath, 'utf8');
  if (content.includes('<!-- ENTRIES -->')) {
    writeFileSync(dailyPath, content.replace('<!-- ENTRIES -->', `${entryMarkdown}\n<!-- ENTRIES -->`));
    return;
  }
  appendFileSync(dailyPath, `\n\n---\n\n${entryMarkdown}\n`);
}

// codex usa pasta própria (codex/dailies/), claude/antigravity/desktop usam a
// dailies/ raiz cross-agente — mesma convenção dos hooks já em produção.
function dailyPathFor(vault, agent, dateStr) {
  if (agent === 'codex') return join(vault, 'codex', 'dailies', `Daily-${dateStr}.md`);
  return join(vault, 'dailies', `Daily-${dateStr}.md`);
}

function writeToVault(vault, session) {
  const { agent, idShort, dateStr, timeStr, markdown, exchanges, project } = session;
  const sessionsDir = join(vault, agent, 'sessions');
  ensureDir(sessionsDir);
  if (fileGlobExists(sessionsDir, idShort)) {
    return { written: false, reason: 'já existe uma sessão com esse id no vault' };
  }
  const agentFileTag = AGENT_FILE_TAG[agent];
  const fileName = `Session-${dateStr}_${timeStr}-${agentFileTag}-${idShort}.md`;
  writeFileSync(join(sessionsDir, fileName), markdown);

  const dailyPath = dailyPathFor(vault, agent, dateStr);
  if (!fileGlobExists(dirname(dailyPath), idShort)) {
    const entry = dailyEntryLine(agent, idShort, timeStr, exchanges, project).replace('Session-PLACEHOLDER', fileName.replace(/\.md$/, ''));
    appendDailyEntry(dailyPath, entry, dateStr, AGENT_LABEL[agent]);
  }
  return { written: true, path: join(sessionsDir, fileName) };
}

// ---------------------------------------------------------------------------
// ai-memory (CLI)
// ---------------------------------------------------------------------------

function resolveAiMemoryBin() {
  const candidates = PLATFORM === 'win32'
    ? [join(HOME, '.cargo', 'bin', 'ai-memory.exe')]
    : [join(HOME, '.local', 'bin', 'ai-memory')];
  return candidates.find(existsSync) || 'ai-memory';
}

let aiMemoryAvailable = null;
function isAiMemoryAvailable() {
  if (aiMemoryAvailable !== null) return aiMemoryAvailable;
  try {
    execFileSync(resolveAiMemoryBin(), ['--version'], { stdio: 'pipe' });
    aiMemoryAvailable = true;
  } catch {
    aiMemoryAvailable = false;
  }
  return aiMemoryAvailable;
}

function writeToAiMemory(session) {
  const { agent, idShort, dateStr, markdown, project } = session;
  if (!isAiMemoryAvailable()) return { written: false, reason: 'binário ai-memory não encontrado no PATH nem em ~/.local/bin' };
  const bin = resolveAiMemoryBin();
  const wikiPath = `sessions/imported-${agent}-${dateStr}-${idShort}.md`;
  const tags = ['session', agent, 'muri-saver', 'imported'];
  if (project) tags.push(project);
  const cliArgs = ['write-page', '--path', wikiPath, '--body', '-', '--tier', 'episodic'];
  for (const t of tags) cliArgs.push('-t', t);
  if (project) cliArgs.push('--project', project);
  try {
    execFileSync(bin, cliArgs, { input: markdown, stdio: ['pipe', 'pipe', 'pipe'] });
    return { written: true, path: wikiPath };
  } catch (err) {
    return { written: false, reason: (err?.stderr?.toString?.() || err?.message || String(err)).slice(0, 300) };
  }
}

// ---------------------------------------------------------------------------
// Export-dir (Markdown avulso)
// ---------------------------------------------------------------------------

function writeToExportDir(exportDir, session) {
  const { agent, idShort, dateStr, timeStr, markdown } = session;
  ensureDir(exportDir);
  const fileName = `${agent}-${dateStr}_${timeStr}-${idShort}.md`;
  writeFileSync(join(exportDir, fileName), markdown);
  return join(exportDir, fileName);
}

// ---------------------------------------------------------------------------
// Orquestração
// ---------------------------------------------------------------------------

const AGENT_DISCOVERERS = {
  claude: discoverClaude,
  antigravity: discoverAntigravity,
  codex: discoverCodex,
};

function resolveSelectedAgents(args) {
  if (args.file) return []; // --file é um caminho separado, não passa pelos discoverers
  if (args.all) return Object.keys(AGENT_DISCOVERERS);
  const valid = args.agents.filter((a) => AGENT_DISCOVERERS[a]);
  const invalid = args.agents.filter((a) => !AGENT_DISCOVERERS[a]);
  for (const a of invalid) log(`AVISO: agente desconhecido "${a}" ignorado (válidos: claude, antigravity, codex, desktop via --file).`);
  return valid;
}

function withinSince(mtimeMs, sinceStr) {
  if (!sinceStr) return true;
  const since = Date.parse(sinceStr);
  if (Number.isNaN(since)) return true;
  return mtimeMs >= since;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const vault = args.vault || join(HOME, 'Documents', 'Obsidian Vault');
  const doVault = !args.skipVault && !args.exportDir;
  const doAiMemory = !args.skipAiMemory && !args.exportDir;

  if (!args.all && !args.agents.length && !args.file) {
    log('Nada a fazer: passe --all, --agent <nome> ou --file <caminho>. Use --help pra ver as opções.');
    return;
  }

  log(`SO: ${PLATFORM} — home: ${HOME}`);
  if (args.dryRun) log('MODO --dry-run: nada será escrito, só listando o que seria importado.');
  if (args.exportDir) log(`Modo export-dir ativo (${args.exportDir}) — ai-memory e Obsidian Vault serão ignorados.`);

  const cache = loadCache();
  let refs = [];

  if (args.file) {
    if (!existsSync(args.file)) {
      log(`FALHA: --file "${args.file}" não encontrado.`);
      process.exitCode = 1;
      return;
    }
    refs = parseDesktopFile(args.file);
    log(`desktop: ${refs.length} conversa(s) reconhecida(s) em ${args.file}`);
  } else {
    const selected = resolveSelectedAgents(args);
    for (const agent of selected) {
      let agentRefs = AGENT_DISCOVERERS[agent]();
      agentRefs = agentRefs.filter((r) => withinSince(r.mtimeMs, args.since));
      agentRefs.sort((a, b) => b.mtimeMs - a.mtimeMs);
      if (args.limit) agentRefs = agentRefs.slice(0, args.limit);
      log(`${agent}: ${agentRefs.length} sessão(ões) encontrada(s)${args.since ? ` desde ${args.since}` : ''}${args.limit ? ` (limitado a ${args.limit})` : ''}`);
      refs.push(...agentRefs);

      if (agent === 'codex') {
        const sqliteFiles = discoverCodexSqliteFiles();
        if (sqliteFiles.length) {
          log(`  AVISO: ${sqliteFiles.length} arquivo(s) SQLite do Codex encontrados (${sqliteFiles.map((f) => basename(f)).join(', ')}) — não suportado por este script (zero-dependência, sem parser binário). Sessões em .jsonl já são cobertas acima.`);
        }
      }
    }
  }

  if (!refs.length) {
    log('Nenhuma sessão encontrada pros critérios passados.');
    return;
  }

  let imported = 0;
  let skippedCached = 0;
  let skippedEmpty = 0;
  let failed = 0;

  for (const ref of refs) {
    const key = cacheKey(ref.agent, ref.id);
    const fingerprint = fingerprintFile(ref.sourcePaths[0]);
    const cached = cache.entries[key];
    const alreadyDone = cached && (args.file || cached.fingerprint === fingerprint) && !args.force;

    if (args.dryRun) {
      const status = alreadyDone ? 'já importado (cache)' : 'seria importado';
      log(`  [${ref.agent}] ${ref.idShort} (${ref.id}) — ${status} — fonte: ${ref.sourcePaths[0]}`);
      continue;
    }

    if (alreadyDone) {
      skippedCached++;
      continue;
    }

    const parsed = parseSession(ref);
    if (!parsed.exchanges.length) {
      skippedEmpty++;
      continue;
    }

    const project = ref.agent === 'desktop' ? null : projectLabelFromCwd(parsed.cwd);
    const startedAtMs = parsed.startedAt ? Date.parse(parsed.startedAt) : ref.mtimeMs;
    const { date: dateStr, time: timeStr } = brDateParts(Number.isNaN(startedAtMs) ? new Date() : new Date(startedAtMs));

    const markdown = buildSessionMarkdown({
      agent: ref.agent, idShort: ref.idShort, id: ref.id, dateStr, timeStr,
      exchanges: parsed.exchanges, toolCallCount: parsed.toolCallCount || 0,
      project, title: parsed.title,
    });

    const session = {
      agent: ref.agent, idShort: ref.idShort, id: ref.id, dateStr, timeStr,
      markdown, exchanges: parsed.exchanges, project,
    };

    let ok = true;
    const results = [];

    if (args.exportDir) {
      try {
        const p = writeToExportDir(args.exportDir, session);
        results.push(`export -> ${p}`);
      } catch (err) {
        ok = false;
        results.push(`export FALHOU: ${err.message}`);
      }
    } else {
      if (doVault) {
        try {
          const r = writeToVault(vault, session);
          results.push(r.written ? `vault -> ${r.path}` : `vault: ${r.reason}`);
        } catch (err) {
          ok = false;
          results.push(`vault FALHOU: ${err.message}`);
        }
      }
      if (doAiMemory) {
        const r = writeToAiMemory(session);
        results.push(r.written ? `ai-memory -> ${r.path}` : `ai-memory: ${r.reason}`);
      }
    }

    log(`  [${ref.agent}] ${ref.idShort} — ${results.join(' | ')}`);
    if (ok) {
      imported++;
      cache.entries[key] = { fingerprint, importedAt: new Date().toISOString() };
    } else {
      failed++;
    }
  }

  if (!args.dryRun) {
    saveCache(cache);
    log(`Resumo: ${imported} importada(s), ${skippedCached} já em cache, ${skippedEmpty} sem conteúdo substantivo, ${failed} com falha.`);
  } else {
    log(`Resumo (dry-run): ${refs.length} sessão(ões) avaliada(s). Nada foi escrito.`);
  }
}

main();
