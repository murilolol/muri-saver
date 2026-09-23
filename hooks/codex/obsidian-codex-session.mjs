import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

// Local-only (no LLM, no network): files touched in the session's cwd via
// git status --porcelain (covers tracked-modified + untracked in one call).
// Timeout + try/catch guarantee this never delays the Stop hook.
function filesTouched(cwd) {
  if (!cwd) return [];
  try {
    const out = execFileSync('git', ['-C', cwd, 'status', '--porcelain'], { encoding: 'utf8', timeout: 1500 });
    return out.split('\n').filter(Boolean).map((l) => l.slice(3).trim()).slice(0, 30);
  } catch {
    return [];
  }
}

// Codex persiste o rollout completo da sessão em
// ~/.codex/sessions/<ano>/<mes>/<dia>/rollout-<ts>-<session_id>.jsonl (achado
// 2026-09-23, `codex migrate-rollouts`/`agents` confirmam o formato). Uma
// varredura recursiva em JS (sem spawn de processo) é rápida o bastante nesse
// volume (dezenas de arquivos) pra achar o rollout pelo session_id sem custo
// de rede/LLM. Não extrai arquivos tocados daqui (os tipos de tool call do
// Codex — exec/custom_tool_call/function_call — não têm um campo de path
// estruturado confiável como o file_path do Claude Code; `git status` já
// cobre isso com mais confiança) nem status de task (Codex não tem um
// TaskCreate/TaskUpdate equivalente confirmado).
function findRolloutPath(sessionId) {
  if (!sessionId) return null;
  const root = path.join(os.homedir(), '.codex', 'sessions');
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name.endsWith(`${sessionId}.jsonl`)) return full;
    }
  }
  return null;
}

const MAX_ROLLOUT_BYTES = 30 * 1024 * 1024; // achado 2026-09-23: sessão real de ~7h gerou rollout de 125MB — sem teto, ler tudo síncrono travaria o /exit numa maratona

function countCodexCommands(rolloutPath) {
  try {
    if (fs.statSync(rolloutPath).size > MAX_ROLLOUT_BYTES) return null;
    const raw = fs.readFileSync(rolloutPath, 'utf8');
    let count = 0;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const pt = obj?.payload?.type;
      if (pt === 'function_call' || pt === 'custom_tool_call') count++;
    }
    return count;
  } catch {
    return null;
  }
}

const vault = process.env.OBSIDIAN_VAULT || path.join(os.homedir(), 'Documents', 'Obsidian Vault');

function brtParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}h${values.minute}`,
    timestamp: `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second} BRT`,
  };
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) || '';
}

try {
  const raw = fs.readFileSync(0, 'utf8').trim();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }

  const sessionId = firstString(payload.session_id, payload.sessionId, payload.thread_id, payload.threadId, payload.conversation_id, payload.conversationId);
  const cwd = firstString(payload.cwd, payload.working_directory, payload.workingDirectory, payload.context?.cwd);
  const id = (sessionId || `local-${process.pid}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(-12) || 'local';
  const { date, time, timestamp } = brtParts();
  const sessionsDir = path.join(vault, 'codex', 'sessions');
  const dailiesDir = path.join(vault, 'codex', 'dailies');
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(dailiesDir, { recursive: true });

  const filename = `Session-${date}_${time}-Codex-${id}.md`;
  const sessionPath = path.join(sessionsDir, filename);
  if (!fs.existsSync(sessionPath)) {
    const touched = filesTouched(cwd);
    const touchedLine = touched.length ? `- Arquivos tocados (${touched.length}): ${touched.map((f) => `\`${f}\``).join(', ')}\n` : '';
    const rolloutPath = findRolloutPath(sessionId);
    const commandCount = rolloutPath ? countCodexCommands(rolloutPath) : null;
    const commandLine = commandCount !== null ? `- Comandos/ações executados: ${commandCount}\n` : '';
    const body = `---\nagent: codex\nsession_id: ${sessionId || 'unavailable'}\ncwd: ${cwd || 'unavailable'}\ncaptured_at: ${timestamp}\n---\n\n# Sessão Codex ${id}\n\n- Registro criado pelo hook local do Codex.\n${commandLine}${touchedLine}- Memória persistente: [[ai-memory]].\n- Para detalhes e decisões duráveis, consulte as páginas do AI Memory.\n`;
    fs.writeFileSync(sessionPath, body, 'utf8');
  }

  const dailyPath = path.join(dailiesDir, `Daily-${date}.md`);
  const entry = `- [[codex/sessions/${filename.replace(/\.md$/, '')}|Sessão Codex ${id}]] (${time}) — [[ai-memory]]\n`;
  const previous = fs.existsSync(dailyPath) ? fs.readFileSync(dailyPath, 'utf8') : `# Diário Codex — ${date}\n\n`;
  if (!previous.includes(filename.replace(/\.md$/, ''))) fs.writeFileSync(dailyPath, previous + entry, 'utf8');
} catch {
  // Never turn a vault-write failure into a failed Codex Stop hook.
}
