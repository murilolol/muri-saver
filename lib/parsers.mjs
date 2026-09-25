import { createReadStream, existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, basename } from 'node:path';

export const AGENTS = ['claude', 'antigravity', 'codex', 'desktop'];

const UUID_RE = /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

export function shortId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'local';
}

function safeEntries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function mtimeOf(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function makeRef(agent, id, path, extra = {}) {
  return { agent, id, idShort: extra.idShort || shortId(id), sourcePaths: [path], mtimeMs: mtimeOf(path), ...extra };
}

export function walkFiles(root, matcher, maxDepth = 6) {
  const out = [];
  const stack = [{ d: root, depth: 0 }];
  while (stack.length) {
    const { d, depth } = stack.pop();
    for (const e of safeEntries(d)) {
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

// Streams line by line: real Codex rollouts reach 125MB+, reading them whole
// would stall or blow memory.
export async function* readJsonLines(path) {
  let stream;
  try {
    stream = createReadStream(path, { encoding: 'utf8' });
  } catch {
    return;
  }
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line);
      } catch {
        // malformed line — skip
      }
    }
  } catch {
    // unreadable file — stop quietly
  }
}

const HOME_DIR_RE = /^(?:[A-Za-z]:[\\/]+Users[\\/]+[^\\/]+|\/(?:Users|home)\/[^/]+|\/root)[\\/]*$/;

// Splits on both separators on purpose: Codex state migrated from a Windows
// machine stores cwd as "C:\Users\...", which node:path on macOS/Linux would
// treat as a single segment.
export function projectLabelFromCwd(cwd) {
  if (!cwd) return null;
  const s = String(cwd).trim();
  if (HOME_DIR_RE.test(s)) return null;
  const parts = s.split(/[\\/]+/).filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || /^[A-Za-z]:$/.test(last)) return null;
  return last;
}

let sqliteModule;
let warningFilterInstalled = false;

export async function loadSqlite() {
  if (sqliteModule !== undefined) return sqliteModule;
  if (!warningFilterInstalled) {
    const original = process.emitWarning;
    process.emitWarning = function filtered(warning, ...rest) {
      const msg = typeof warning === 'string' ? warning : warning?.message;
      if (/SQLite is an experimental feature/i.test(String(msg))) return undefined;
      return original.call(process, warning, ...rest);
    };
    warningFilterInstalled = true;
  }
  try {
    const mod = await import('node:sqlite');
    sqliteModule = mod.DatabaseSync || null;
  } catch {
    sqliteModule = null;
  }
  return sqliteModule;
}

// ---------------------------------------------------------------- Claude Code

export function discoverClaude(home, { includeSubagents = false } = {}) {
  const projectsDir = join(home, '.claude', 'projects');
  const refs = [];
  let skippedSubagents = 0;
  for (const proj of safeEntries(projectsDir)) {
    if (!proj.isDirectory()) continue;
    const projDir = join(projectsDir, proj.name);
    for (const e of safeEntries(projDir)) {
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        refs.push(makeRef('claude', basename(e.name, '.jsonl'), join(projDir, e.name)));
        continue;
      }
      if (!e.isDirectory()) continue;
      const subDir = join(projDir, e.name, 'subagents');
      for (const s of safeEntries(subDir)) {
        if (!s.isFile() || !s.name.endsWith('.jsonl')) continue;
        if (!includeSubagents) {
          skippedSubagents++;
          continue;
        }
        const agentPart = basename(s.name, '.jsonl').replace(/^agent-/, '');
        refs.push(makeRef('claude', `${e.name}-${agentPart}`, join(subDir, s.name), {
          idShort: shortId(agentPart), isSubagent: true, parentId: e.name,
        }));
      }
    }
  }
  return { refs, skippedSubagents, notes: [] };
}

function isCommandNoise(text) {
  return text.startsWith('<command-name>') || text.startsWith('<local-command-stdout>') || text.includes('<local-command-caveat>');
}

export async function parseClaudeSession(ref) {
  const exchanges = [];
  let cwd = null;
  let toolCallCount = 0;
  let startedAt = null;
  for await (const obj of readJsonLines(ref.sourcePaths[0])) {
    if (obj.cwd && !cwd) cwd = obj.cwd;
    if (obj.timestamp && !startedAt) startedAt = obj.timestamp;
    if (obj.isMeta || (obj.isSidechain && !ref.isSubagent)) continue;
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
    text = text.trim();
    if (!text || isCommandNoise(text)) continue;
    exchanges.push({ role, text, ts: obj.timestamp || null });
  }
  return { exchanges, cwd, toolCallCount, startedAt };
}

// ---------------------------------------------------------------- Antigravity

export function discoverAntigravity(home) {
  const brainDir = join(home, '.gemini', 'antigravity-cli', 'brain');
  const refs = [];
  for (const e of safeEntries(brainDir)) {
    if (!e.isDirectory()) continue;
    const logsDir = join(brainDir, e.name, '.system_generated', 'logs');
    const full = join(logsDir, 'transcript_full.jsonl');
    const fallback = join(logsDir, 'transcript.jsonl');
    const path = existsSync(full) ? full : (existsSync(fallback) ? fallback : null);
    if (path) refs.push(makeRef('antigravity', e.name, path, { truncatedSource: path === fallback }));
  }
  return { refs, skippedSubagents: 0, notes: [] };
}

const GENERIC_DIRS = new Set(['src', 'app', 'apps', 'lib', 'libs', 'components', 'pages', 'public', 'test', 'tests', 'scripts', 'styles', 'assets', 'packages', 'server', 'client', 'config']);

// A file path like /home/dev/landing-page/src/Hero.tsx should map to
// "landing-page", not "src".
function projectDirFromFile(filePath) {
  const parts = String(filePath).split(/[\\/]+/);
  parts.pop();
  while (parts.length > 1 && GENERIC_DIRS.has(parts[parts.length - 1].toLowerCase())) parts.pop();
  const sep = String(filePath).includes('\\') ? '\\' : '/';
  return parts.join(sep);
}

export async function parseAntigravitySession(ref) {
  const exchanges = [];
  let toolCallCount = 0;
  let startedAt = null;
  let cwdHint = null;
  for await (const obj of readJsonLines(ref.sourcePaths[0])) {
    if (obj.created_at && !startedAt) startedAt = obj.created_at;
    if (Array.isArray(obj.tool_calls)) {
      toolCallCount += obj.tool_calls.length;
      if (!cwdHint) {
        for (const tc of obj.tool_calls) {
          const p = tc?.args?.Cwd || tc?.args?.cwd || tc?.args?.TargetFile || tc?.args?.path;
          if (typeof p === 'string' && /[\\/]/.test(p)) {
            cwdHint = tc?.args?.Cwd || tc?.args?.cwd ? p : projectDirFromFile(p);
            break;
          }
        }
      }
    }
    if (typeof obj.content !== 'string' || !obj.content.trim()) continue;
    if (obj.type === 'USER_INPUT') exchanges.push({ role: 'user', text: obj.content.trim(), ts: obj.created_at || null });
    else if (obj.type === 'PLANNER_RESPONSE') exchanges.push({ role: 'assistant', text: obj.content.trim(), ts: obj.created_at || null });
  }
  return { exchanges, cwd: cwdHint, toolCallCount, startedAt };
}

// ---------------------------------------------------------------- Codex

function latestDb(dir, prefix) {
  const re = new RegExp(`^${prefix}_(\\d+)\\.sqlite$`);
  const matches = safeEntries(dir)
    .filter((e) => e.isFile() && re.test(e.name))
    .map((e) => ({ name: e.name, n: Number(e.name.match(re)[1]) }))
    .sort((a, b) => b.n - a.n);
  return matches.length ? join(dir, matches[0].name) : null;
}

export function listCodexSqliteFiles(home) {
  const codexDir = join(home, '.codex');
  return safeEntries(codexDir).filter((e) => e.isFile() && e.name.endsWith('.sqlite')).map((e) => join(codexDir, e.name));
}

export function isCodexSubagent(thread) {
  if (!thread?.source) return false;
  try {
    const s = JSON.parse(thread.source);
    return Boolean(s && typeof s === 'object' && s.subagent);
  } catch {
    return /subagent/i.test(String(thread.source));
  }
}

// state_N.sqlite holds a clean index (cwd, title, subagent origin) of every
// thread; thread_history_N.sqlite holds the items themselves, which lets us
// recover threads whose rollout .jsonl no longer exists on disk.
export async function loadCodexIndex(home) {
  const codexDir = join(home, '.codex');
  const Db = await loadSqlite();
  const index = { available: Boolean(Db), statePath: null, historyPath: null, threads: new Map(), historyThreadIds: new Set() };
  if (!Db) return index;
  index.statePath = latestDb(codexDir, 'state');
  index.historyPath = latestDb(codexDir, 'thread_history');
  if (index.statePath) {
    try {
      const db = new Db(index.statePath, { readOnly: true });
      for (const r of db.prepare('SELECT id, rollout_path, created_at, updated_at, cwd, title, source FROM threads').all()) {
        index.threads.set(r.id, { ...r });
      }
      db.close();
    } catch {
      // schema drift in a future Codex version — fall back to rollouts only
    }
  }
  if (index.historyPath) {
    try {
      const db = new Db(index.historyPath, { readOnly: true });
      for (const r of db.prepare('SELECT DISTINCT thread_id FROM thread_items').all()) index.historyThreadIds.add(r.thread_id);
      db.close();
    } catch {
      // idem
    }
  }
  return index;
}

export async function discoverCodex(home, { includeSubagents = false } = {}) {
  const sessionsDir = join(home, '.codex', 'sessions');
  const index = await loadCodexIndex(home);
  const refs = [];
  const seen = new Set();
  let skippedSubagents = 0;
  const notes = [];

  for (const full of walkFiles(sessionsDir, (name) => name.startsWith('rollout-') && name.endsWith('.jsonl'), 4)) {
    const m = basename(full, '.jsonl').match(UUID_RE);
    const id = m ? m[1] : basename(full, '.jsonl');
    const thread = index.threads.get(id);
    const isSubagent = isCodexSubagent(thread);
    seen.add(id);
    if (isSubagent && !includeSubagents) {
      skippedSubagents++;
      continue;
    }
    refs.push(makeRef('codex', id, full, { cwd: thread?.cwd || null, title: thread?.title || null, isSubagent }));
  }

  for (const [id, thread] of index.threads) {
    if (seen.has(id) || !index.historyThreadIds.has(id)) continue;
    const isSubagent = isCodexSubagent(thread);
    if (isSubagent && !includeSubagents) {
      skippedSubagents++;
      continue;
    }
    refs.push({
      agent: 'codex', id, idShort: shortId(id), sourcePaths: [index.historyPath],
      mtimeMs: (thread.updated_at || thread.created_at || 0) * 1000, kind: 'codex-sqlite',
      cwd: thread.cwd || null, title: thread.title || null, isSubagent, startedAtEpoch: thread.created_at,
    });
  }

  const sqliteFiles = listCodexSqliteFiles(home);
  if (!index.available && sqliteFiles.length) {
    notes.push(`${sqliteFiles.length} arquivo(s) SQLite do Codex encontrados, mas este Node não tem node:sqlite (precisa de Node >= 22.5) — só os rollouts .jsonl foram lidos.`);
  }
  return { refs, skippedSubagents, notes, sqliteAvailable: index.available };
}

async function parseCodexSqliteThread(ref) {
  const Db = await loadSqlite();
  const empty = { exchanges: [], cwd: ref.cwd || null, toolCallCount: 0, startedAt: ref.startedAtEpoch || null };
  if (!Db) return empty;
  const exchanges = [];
  let toolCallCount = 0;
  let startedAt = null;
  try {
    const db = new Db(ref.sourcePaths[0], { readOnly: true });
    const rows = db.prepare('SELECT item_type, item_json, created_at_ms FROM thread_items WHERE thread_id = ? ORDER BY rollout_ordinal').all(ref.id);
    db.close();
    for (const r of rows) {
      if (!startedAt && r.created_at_ms) startedAt = r.created_at_ms;
      let item;
      try {
        item = JSON.parse(r.item_json);
      } catch {
        continue;
      }
      if (r.item_type === 'userMessage') {
        const text = (Array.isArray(item.content) ? item.content : []).map((c) => c?.text).filter(Boolean).join('\n').trim();
        if (text) exchanges.push({ role: 'user', text, ts: r.created_at_ms });
      } else if (r.item_type === 'agentMessage') {
        const text = String(item.text || '').trim();
        if (text) exchanges.push({ role: 'assistant', text, ts: r.created_at_ms });
      } else if (['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch'].includes(r.item_type)) {
        toolCallCount++;
      }
    }
  } catch {
    return empty;
  }
  return { exchanges, cwd: ref.cwd || null, toolCallCount, startedAt: startedAt || ref.startedAtEpoch || null };
}

export async function parseCodexSession(ref) {
  if (ref.kind === 'codex-sqlite') return parseCodexSqliteThread(ref);
  const exchanges = [];
  let toolCallCount = 0;
  let startedAt = null;
  let cwd = ref.cwd || null;
  for await (const obj of readJsonLines(ref.sourcePaths[0])) {
    if (obj.type === 'session_meta') {
      cwd = cwd || obj.payload?.cwd || null;
      startedAt = startedAt || obj.payload?.timestamp || obj.timestamp || null;
      continue;
    }
    if (obj.type !== 'response_item') continue;
    const p = obj.payload || {};
    if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
      const text = (Array.isArray(p.content) ? p.content : []).map((c) => c?.text).filter(Boolean).join('\n').trim();
      if (text && !/^<(?:environment_context|user_instructions|INSTRUCTIONS)>/.test(text) && !text.startsWith('# AGENTS.md instructions')) {
        exchanges.push({ role: p.role, text, ts: obj.timestamp || null });
      }
    } else if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      toolCallCount++;
    }
  }
  return { exchanges, cwd, toolCallCount, startedAt };
}

// ---------------------------------------------------------------- Desktop/Web

// Manual export (Settings -> Export data). The format drifts between export
// versions, so this is tolerant: unknown conversations are skipped, never thrown.
export function parseDesktopFile(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { refs: [], skippedSubagents: 0, notes: [`não consegui ler ${path} como JSON`] };
  }
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
        if (!text && Array.isArray(m.content)) text = m.content.map((c) => c?.text).filter(Boolean).join('\n');
        text = String(text || '').trim();
        if (text) exchanges.push({ role, text, ts: m.created_at || m.timestamp || null });
      }
      if (!exchanges.length) continue;
      refs.push({
        agent: 'desktop', id, idShort: shortId(id), sourcePaths: [path],
        mtimeMs: Date.parse(conv.created_at || conv.updated_at || '') || Date.now(),
        preParsed: { exchanges, cwd: null, toolCallCount: 0, startedAt: conv.created_at || null, title: conv.name || null },
      });
    } catch {
      // malformed conversation — skip
    }
  }
  return { refs, skippedSubagents: 0, notes: [] };
}

// ---------------------------------------------------------------- dispatch

export async function discoverAgent(agent, home, opts = {}) {
  if (agent === 'claude') return discoverClaude(home, opts);
  if (agent === 'antigravity') return discoverAntigravity(home, opts);
  if (agent === 'codex') return discoverCodex(home, opts);
  return { refs: [], skippedSubagents: 0, notes: [] };
}

export async function parseSession(ref) {
  if (ref.preParsed) return ref.preParsed;
  if (ref.agent === 'claude') return parseClaudeSession(ref);
  if (ref.agent === 'antigravity') return parseAntigravitySession(ref);
  if (ref.agent === 'codex') return parseCodexSession(ref);
  return { exchanges: [], cwd: null, toolCallCount: 0, startedAt: null };
}
