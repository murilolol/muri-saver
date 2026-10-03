#!/usr/bin/env node
// Reprocessa as sessões que o scheduler do ai-memory estacionou (parked=true)
// quando a cadeia de LLM esgotou. O scheduler não tenta de novo as
// estacionadas, então sem isto elas nunca viram página na wiki.
//
// Fila: TSV "session_id<TAB>workspace<TAB>project". Na primeira execução (sem
// fila) ou com --scan, ela é montada a partir dos logs do ai-memory: sessões
// com "auto-improve failed ... parked=true" que não tiveram um "completed"
// depois. Uma sessão por vez, --sleep segundos entre elas (padrão 60).
//
// Pensado para o job `reprocess-parked` (toda hora, no minuto 10, logo depois
// do reset diário da API do Gemini):
//   - sem modelo livre na cadeia → sai na hora (exit 75), sem gastar nada;
//   - cota acaba no meio → a sessão fica na fila para a próxima rodada;
//   - falha da própria sessão → vai para a lista de falhas, que ganha UMA nova
//     passada quando a fila zera;
//   - 3 falhas seguidas → parece problema geral, para;
//   - fila zerada de vez → o job se desativa sozinho.
//
// Uso:
//   node ai-memory-reprocess-parked.mjs [--limit N] [--sleep S]
//   node ai-memory-reprocess-parked.mjs --scan [--exclude tmp,scratch] [--dry-run]
// Log: ~/.claude/hooks/.ai-memory-reprocess.log

import { existsSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, statSync, readdirSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  RUNTIME_DIR, RUNTIME_SCRIPTS_DIR, bin, shimPort, loadConfig, aiMemoryPaths, isMain, appendLog,
} from '../hooks/muri-common.mjs';
import { disableJob } from './muri-jobs.mjs';

const QUEUE = process.env.MURI_REPROCESS_QUEUE || join(RUNTIME_SCRIPTS_DIR, '.ai-memory-parked-queue.tsv');
const FAILED = `${QUEUE.replace(/-queue\.tsv$/, '')}-failed.tsv`;
const RETRIED = `${QUEUE.replace(/-queue\.tsv$/, '')}-retried`;
const PIDFILE = join(RUNTIME_SCRIPTS_DIR, '.ai-memory-reprocess.pid');
const LOG = join(RUNTIME_DIR, '.ai-memory-reprocess.log');
const MAX_FAILS_IN_ROW = 3;
const QUOTA_RE = /exhausted|429|quota|all candidates failed|rate.?limit/i;

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i === -1 ? def : args[i + 1]; };
const LIMIT = Number(opt('--limit', Infinity)) || Infinity;
const SLEEP_MS = Number(opt('--sleep', process.env.SLEEP || 60)) * 1000;
const DRY = args.includes('--dry-run');

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  if (process.stdout.isTTY || DRY) console.log(line);
  appendLog(LOG, line);
}

// Filas antigas tinham 2 colunas (session_id, project): o workspace vira "default".
const readTsv = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean)
  .map((l) => l.split('\t')).map((r) => (r.length === 2 ? [r[0], 'default', r[1]] : r)) : []);
const writeTsv = (p, rows) => writeFileSync(p, rows.map((r) => r.join('\t')).join('\n') + (rows.length ? '\n' : ''));
const pending = () => readTsv(QUEUE).length;

// ------------------------------------------------------------------ scan

const LINE_RE = /scheduled auto-improve (failed|completed) workspace=(\S+) project=(.+?) session_id=([0-9a-f-]{36})(.*)$/;

export function scanLogText(text, state = new Map()) {
  for (const line of text.split('\n')) {
    const m = line.match(LINE_RE);
    if (!m) continue;
    const [, kind, workspace, project, sid, rest] = m;
    if (kind === 'completed') state.set(sid, { status: 'done', workspace, project });
    else if (/parked=true/.test(rest)) state.set(sid, { status: 'parked', workspace, project });
  }
  return state;
}

function scan(exclude) {
  const logsDir = join(aiMemoryPaths().dataDir, 'logs');
  let files = [];
  try { files = readdirSync(logsDir).filter((f) => f.startsWith('ai-memory.log')).sort(); } catch { /* sem logs */ }
  const state = new Map();
  for (const f of files) {
    try { scanLogText(readFileSync(join(logsDir, f), 'utf8'), state); } catch { /* arquivo ilegível */ }
  }
  const known = new Set([...readTsv(QUEUE), ...readTsv(FAILED)].map((r) => r[0]));
  const fresh = [...state].filter(([sid, s]) => s.status === 'parked' && !known.has(sid) && !exclude.has(s.project))
    .map(([sid, s]) => [sid, s.workspace, s.project]);
  return { fresh, files: files.length, parked: [...state.values()].filter((s) => s.status === 'parked').length };
}

// ------------------------------------------------------------------ cadeia

// Com o shim da cadeia de pé, /health diz se algum modelo está livre. Sem shim
// (o ai-memory usa outro provedor), não dá pra saber antes: assume que sim e
// decide pelo texto do erro.
async function chainAvailable() {
  const cfg = loadConfig();
  try {
    const res = await fetch(`http://127.0.0.1:${shimPort(cfg)}/health`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    return (data.chain || []).some((c) => c.available);
  } catch {
    return !cfg.llm?.shim;
  }
}

// ------------------------------------------------------------------ fila

function lockOrExit() {
  if (existsSync(PIDFILE)) {
    const pid = Number(readFileSync(PIDFILE, 'utf8'));
    let alive = false;
    try { process.kill(pid, 0); alive = Date.now() - statSync(PIDFILE).mtimeMs < 12 * 3600 * 1000; } catch { alive = false; }
    if (alive) process.exit(0);
  }
  writeFileSync(PIDFILE, String(process.pid));
  process.on('exit', () => { try { unlinkSync(PIDFILE); } catch { /* ok */ } });
}

function finish() {
  log(`fila vazia, desativando o job reprocess-parked${existsSync(FAILED) ? ` (${readTsv(FAILED).length} falhas definitivas em ${FAILED})` : ''}`);
  try { if (existsSync(RETRIED)) unlinkSync(RETRIED); } catch { /* ok */ }
  disableJob('reprocess-parked');
  process.exit(0);
}

// Fila principal vazia: as falhas ganham uma única segunda passada; depois, desativa.
function refillOrFinish() {
  if (pending() > 0) return;
  if (readTsv(FAILED).length && !existsSync(RETRIED)) {
    log(`fila vazia, devolvendo ${readTsv(FAILED).length} falhas para uma segunda passada`);
    renameSync(FAILED, QUEUE);
    writeFileSync(RETRIED, '');
    return;
  }
  finish();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(dirname(QUEUE), { recursive: true });
  if (args.includes('--scan') || !existsSync(QUEUE)) {
    const exclude = new Set(String(opt('--exclude', 'tmp,scratch')).split(',').filter(Boolean));
    const { fresh, files, parked } = scan(exclude);
    log(`scan: ${files} arquivo(s) de log, ${parked} estacionada(s), ${fresh.length} nova(s) na fila`);
    if (DRY) { for (const r of fresh) console.log(r.join('\t')); return 0; }
    writeTsv(QUEUE, [...readTsv(QUEUE), ...fresh]);
    if (args.includes('--scan')) return 0;
  }
  lockOrExit();
  refillOrFinish();
  if (!(await chainAvailable())) {
    log(`cadeia em cooldown (ou shim fora do ar), ${pending()} pendentes, tento na próxima rodada`);
    return 75;
  }
  const aim = bin('ai-memory');
  if (!aim) { log('binário ai-memory não encontrado'); return 1; }

  log(`início: ${pending()} pendentes`);
  let n = 0;
  let fails = 0;
  while (pending() > 0 && n < LIMIT) {
    const [sid, workspace, project] = readTsv(QUEUE)[0];
    if (n > 0) {
      await sleep(SLEEP_MS);
      if (!(await chainAvailable())) { log(`cadeia esgotou, parando com ${pending()} pendentes`); return 75; }
    }
    n++;
    const t0 = Date.now();
    const r = spawnSync(aim.cmd, [...aim.pre, 'auto-improve', '--session-id', sid, '--workspace', workspace || 'default', '--project', project], {
      encoding: 'utf8', timeout: 20 * 60 * 1000, windowsHide: true,
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
    const last = out.split('\n').pop()?.slice(0, 200) || '';
    const secs = Math.round((Date.now() - t0) / 1000);
    if (r.status === 0) {
      fails = 0;
      log(`ok ${sid} [${project}] ${secs}s ${last}`);
    } else if (!(await chainAvailable()) || (!loadConfig().llm?.shim && QUOTA_RE.test(out))) {
      // A cota acabou no meio da sessão: ela fica na fila para a próxima rodada.
      log(`cadeia esgotada em ${sid} [${project}], parando com ${pending()} pendentes: ${last}`);
      return 75;
    } else {
      fails++;
      log(`falha ${sid} [${project}] rc=${r.status}: ${last}`);
      appendFileSync(FAILED, `${sid}\t${workspace}\t${project}\n`);
    }
    writeTsv(QUEUE, readTsv(QUEUE).slice(1));
    if (fails >= MAX_FAILS_IN_ROW) {
      log(`${fails} falhas seguidas, parece problema geral: parando com ${pending()} pendentes`);
      return 75;
    }
    refillOrFinish();
  }
  log(`fim: ${n} processadas, ${pending()} pendentes`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await main();
