#!/usr/bin/env node
// Encerra no ai-memory as sessões abertas e ociosas há mais de --idle-hours
// (padrão 2h).
//
// Por quê: agentes sem evento SessionEnd (o Antigravity, ou um Claude/Codex
// fechado à força) deixam a sessão aberta para sempre, e o auto-improve do
// ai-memory só consolida sessão encerrada. Sem isto, semanas de trabalho
// nunca viram página na wiki.
//
// Uso:
//   node ai-memory-finalize-idle.mjs              encerra
//   node ai-memory-finalize-idle.mjs --dry-run    só lista
//   node ai-memory-finalize-idle.mjs --idle-hours 6
// Job: `muri-saver jobs install finalize-idle` (de hora em hora).
// Log: ~/.claude/hooks/.ai-memory-finalize-idle.log

import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  RUNTIME_DIR, AI_MEMORY_PORT, bin, tcpUp, aiMemoryPaths, sqliteQuery, isMain, appendLog,
} from '../hooks/muri-common.mjs';

const LOG = join(RUNTIME_DIR, '.ai-memory-finalize-idle.log');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const hoursArg = args.indexOf('--idle-hours');
const IDLE_SECS = Math.round((hoursArg !== -1 ? Number(args[hoursArg + 1]) : Number(process.env.IDLE_HOURS || 2)) * 3600) || 7200;

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  if (DRY) console.log(line);
  appendLog(LOG, line);
}

// Timestamps do DB do ai-memory são microssegundos desde a época. Ociosidade =
// última observação (ou o início, se a sessão não tem nenhuma).
export function idleSessionsSql(idleSecs, nowSecs = Math.floor(Date.now() / 1000)) {
  return `SELECT s.agent_kind AS agent,
       lower(substr(hex(s.id),1,8)||'-'||substr(hex(s.id),9,4)||'-'||substr(hex(s.id),13,4)||'-'||substr(hex(s.id),17,4)||'-'||substr(hex(s.id),21)) AS sid,
       w.name AS workspace, p.name AS project
FROM sessions s
JOIN projects p ON p.id = s.project_id
JOIN workspaces w ON w.id = s.workspace_id
WHERE s.ended_at IS NULL
  AND coalesce((SELECT max(o.created_at) FROM observations o WHERE o.session_id = s.id), s.started_at)
      < ${(nowSecs - idleSecs)} * 1000000;`;
}

async function main() {
  const aim = bin('ai-memory');
  if (!aim) { log('binário ai-memory não encontrado, pulando'); return 0; }
  // O finalize-session fala com o servidor; sem ele não há o que fazer agora.
  if (!(await tcpUp(AI_MEMORY_PORT))) { log('servidor ai-memory fora do ar, pulando'); return 0; }
  const rows = await sqliteQuery(aiMemoryPaths().dbPath, idleSessionsSql(IDLE_SECS));
  if (rows === null) { log('não consegui ler o banco do ai-memory (precisa de Node >= 22.5 ou do sqlite3 no PATH)'); return 1; }
  if (rows.length === 0) return 0;
  let ok = 0;
  let fail = 0;
  for (const r of rows) {
    if (DRY) { console.log(`${r.agent} ${r.sid} ${r.workspace}/${r.project}`); continue; }
    try {
      const out = execFileSync(aim.cmd, [...aim.pre, 'finalize-session', '--agent', r.agent, '--session-id', r.sid,
        '--workspace', r.workspace, '--project', r.project, '--json'], {
        encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
      if (out.includes(r.sid)) ok++;
      else { fail++; log(`sem confirmação ${r.agent} ${r.sid} ${r.workspace}/${r.project}`); }
    } catch (e) {
      fail++;
      log(`falhou ${r.agent} ${r.sid} ${r.workspace}/${r.project}: ${String(e.stderr || e.message).split('\n').filter((l) => !l.includes(' INFO ')).join(' ').slice(0, 200)}`);
    }
  }
  if (!DRY) log(`finalizadas=${ok} falhas=${fail} (ociosas > ${IDLE_SECS}s)`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await main();
