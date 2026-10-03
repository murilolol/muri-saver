#!/usr/bin/env node
// Devolve narrativa às notas do vault que ficaram só com o dump local: notas
// de antes da nota viva, sessões em que a cadeia de LLM estava em cooldown, ou
// sessões que terminaram antes do primeiro intervalo de regeração.
//
// Fila em ~/.claude/hooks/.vault-state/backfill.json. Uma nota por vez, 60s
// entre chamadas. Cada nota é processada pelo próprio hook do vault com
// MURI_VAULT_BACKFILL=1, que usa só o 1º modelo da cadeia de narrativa (ou
// llm.backfill): no primeiro limite o hook sai com 75, o backfill para e
// guarda a posição. A narrativa entra como bloco novo na nota (o resto fica
// intacto), mais a linha "↳ Narrativa" no Daily e a taxonomia do projeto.
//
// Uso:
//   node vault-backfill.mjs [--dry-run] [--limit N] [--since AAAA-MM-DD] [--rebuild]
// --since vale na montagem da fila (padrão: últimos 14 dias). --rebuild descarta
// a fila salva e monta de novo. Job: `muri-saver jobs install vault-backfill`
// (a cada 2h, se desativa quando a fila zera).

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, appendFileSync, unlinkSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  HOOKS_DIR, RUNTIME_DIR, STATE_DIR, loadConfig, resolveVault, expandHome, isMain, appendLog,
} from '../hooks/muri-common.mjs';
import { disableJob } from './muri-jobs.mjs';

const HOME = os.homedir();
const CFG = loadConfig();
const VAULT = resolveVault(CFG);
const HOOK = join(HOOKS_DIR, 'obsidian-vault-check.mjs');
const QUEUE_FILE = join(STATE_DIR, 'backfill.json');
const LOCK_FILE = join(STATE_DIR, 'backfill.lock');
const LOG = join(RUNTIME_DIR, '.vault-backfill.log');
const CLAUDE_PROJECTS = join(expandHome(CFG.paths?.claudeDir) || join(HOME, '.claude'), 'projects');
const CODEX_DIR = expandHome(CFG.paths?.codexDir) || join(HOME, '.codex');
const GEMINI_DIR = expandHome(CFG.paths?.geminiDir) || join(HOME, '.gemini');
const GAP_MS = 60 * 1000;
const MAX_ATTEMPTS = 2;
const EXIT_RATE_LIMITED = 75;
const NARR_START = '<!-- auto-narrativa:start -->';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i === -1 ? def : args[i + 1]; };
const DRY = args.includes('--dry-run');
const LIMIT = Number(opt('--limit', Infinity)) || Infinity;
const SINCE = opt('--since', new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10));

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  appendLog(LOG, line);
}

// Nota com narrativa = bloco marcado já preenchido, ou narrativa de versões
// antigas do hook (seção "Síntese Executiva" sem marcador).
export function hasNarrative(c) {
  if (c.includes(NARR_START)) return !c.includes('_Narrativa pendente');
  return c.includes('Síntese Executiva');
}

function notes(agentDir) {
  const dir = join(VAULT, agentDir, 'sessions');
  try {
    return readdirSync(dir)
      .filter((n) => n.startsWith('Session-') && n.endsWith('.md') && n.slice(8, 18) >= SINCE)
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

function findClaudeTranscript(uuid) {
  try {
    for (const d of readdirSync(CLAUDE_PROJECTS)) {
      const p = join(CLAUDE_PROJECTS, d, `${uuid}.jsonl`);
      if (existsSync(p)) return p;
    }
  } catch { /* sem projetos */ }
  return null;
}

function findCodexRollout(sessionId) {
  const stack = [join(CODEX_DIR, 'sessions')];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name.endsWith(`${sessionId}.jsonl`)) return full;
    }
  }
  return null;
}

// Só vale gastar modelo com sessão de verdade: 2+ mensagens digitadas pelo usuário.
const CODEX_INJECTED = /^\s*(# AGENTS\.md instructions|<environment_context>|<user_instructions>|<permissions|<INSTRUCTIONS>|<skills?_instructions>|<turn_aborted>)/;
export function countUserMessages(path, agent) {
  try {
    if (statSync(path).size > 60 * 1024 * 1024) return 0;
    let n = 0;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      if (agent === 'codex') {
        const p = d.payload || {};
        if (d.type === 'response_item' && p.type === 'message' && p.role === 'user') {
          const t = (p.content || []).map((c) => c?.text || '').join('');
          if (t.trim() && !CODEX_INJECTED.test(t)) n++;
        }
        continue;
      }
      const role = d.type || d.role;
      if ((role === 'user' || role === 'USER_INPUT') && !d.isMeta) {
        const c = d.message?.content ?? d.content;
        const text = typeof c === 'string' ? c : Array.isArray(c) ? (c.find((x) => x?.type === 'text')?.text || '') : '';
        if (text.trim() && !text.trim().startsWith('<command-name>') && !text.includes('<local-command-caveat>')) n++;
      }
    }
    return n;
  } catch {
    return 0;
  }
}

function buildQueue() {
  const queue = [];
  const skipped = { semTranscript: 0, trivial: 0 };
  for (const agent of ['claude', 'antigravity', 'codex']) {
    for (const note of notes(agent)) {
      const c = readFileSync(note, 'utf8');
      if (hasNarrative(c)) continue;
      const uuid = (c.match(/^session_uuid: (\S+)/m) || [])[1] || (c.match(/\(`([0-9a-f-]{36})`\)/) || [])[1];
      const sessionId = agent === 'codex' ? (uuid || (c.match(/^session_id: (\S+)/m) || [])[1]) : uuid;
      const cwd = (c.match(/^cwd: "?([^"\n]+)"?$/m) || [])[1] || HOME;
      let transcript = null;
      if (sessionId && agent === 'claude') transcript = findClaudeTranscript(sessionId);
      if (sessionId && agent === 'antigravity') {
        const logs = join(GEMINI_DIR, 'antigravity-cli', 'brain', sessionId, '.system_generated', 'logs');
        transcript = [join(logs, 'transcript_full.jsonl'), join(logs, 'transcript.jsonl')].find(existsSync) || null;
      }
      if (sessionId && agent === 'codex') transcript = findCodexRollout(sessionId);
      if (!transcript) { skipped.semTranscript++; continue; }
      if (countUserMessages(transcript, agent) < 2) { skipped.trivial++; continue; }
      queue.push({ agent, sessionId, transcript, note, cwd, attempts: 0 });
    }
  }
  queue.sort((a, b) => basename(a.note).localeCompare(basename(b.note)));
  return { queue, skipped };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!VAULT) { log('Obsidian desativado nesta instalação (vault: null), nada a fazer'); disableJob('vault-backfill'); return 0; }
  mkdirSync(STATE_DIR, { recursive: true });
  if (existsSync(LOCK_FILE) && Date.now() - statSync(LOCK_FILE).mtimeMs < 6 * 3600 * 1000) {
    log('outra execução em andamento (lock), saindo');
    return 0;
  }
  let state = !args.includes('--rebuild') && existsSync(QUEUE_FILE) ? JSON.parse(readFileSync(QUEUE_FILE, 'utf8')) : null;
  if (!state) {
    const { queue, skipped } = buildQueue();
    state = { createdAt: new Date().toISOString(), since: SINCE, queue, done: [], failed: [], skipped };
    if (!DRY) writeFileSync(QUEUE_FILE, JSON.stringify(state, null, 2));
  }
  const counts = state.queue.reduce((acc, it) => ({ ...acc, [it.agent]: (acc[it.agent] || 0) + 1 }), {});
  log(`fila: ${state.queue.length} pendentes ${JSON.stringify(counts)} · feitas ${state.done.length} · falhas ${state.failed.length} · puladas ${JSON.stringify(state.skipped)}`);
  if (DRY) {
    for (const it of state.queue) console.log(`  ${it.agent.padEnd(12)} ${basename(it.note)}`);
    return 0;
  }
  if (state.queue.length === 0) {
    log('fila vazia, desativando o job vault-backfill');
    disableJob('vault-backfill');
    return 0;
  }

  writeFileSync(LOCK_FILE, String(process.pid));
  try {
    let processed = 0;
    while (state.queue.length && processed < LIMIT) {
      const item = state.queue[0];
      const input = {
        session_id: item.sessionId,
        transcript_path: item.transcript,
        cwd: item.cwd,
        vault_session_path: item.note,
        hook_event_name: 'SessionEnd',
        ...(item.agent === 'antigravity' ? { conversationId: item.sessionId } : {}),
        ...(item.agent === 'codex' ? { agent: 'codex' } : {}),
      };
      const inputPath = join(os.tmpdir(), `muri-backfill-${Date.now()}.json`);
      writeFileSync(inputPath, JSON.stringify(input));
      const t0 = Date.now();
      const r = spawnSync(process.execPath, [HOOK, inputPath], {
        env: { ...process.env, MURI_VAULT_WORKER: '1', MURI_VAULT_BACKFILL: '1' },
        stdio: 'ignore', timeout: 25 * 60 * 1000, windowsHide: true,
      });
      try { unlinkSync(inputPath); } catch { /* ok */ }
      const secs = Math.round((Date.now() - t0) / 1000);
      const name = basename(item.note);
      if (r.status === EXIT_RATE_LIMITED) {
        log(`limite do modelo em ${name}, parando; retoma na próxima rodada do job`);
        break;
      }
      state.queue.shift();
      if (r.status === 0 && hasNarrative(readFileSync(item.note, 'utf8'))) {
        state.done.push(item.note);
        log(`ok ${name} (${secs}s)`);
      } else if (++item.attempts < MAX_ATTEMPTS) {
        state.queue.push(item);
        log(`falhou ${name} (status ${r.status ?? r.signal}, ${secs}s), volta pro fim da fila`);
      } else {
        state.failed.push(item.note);
        log(`desistiu de ${name} após ${MAX_ATTEMPTS} tentativas`);
      }
      writeFileSync(QUEUE_FILE, JSON.stringify(state, null, 2));
      processed++;
      if (state.queue.length && processed < LIMIT) await sleep(GAP_MS);
    }
    if (state.queue.length === 0) {
      log('fila vazia, desativando o job vault-backfill');
      disableJob('vault-backfill');
    }
  } finally {
    try { unlinkSync(LOCK_FILE); } catch { /* ok */ }
  }
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await main();
