#!/usr/bin/env node
// Hook Stop/SessionEnd do Codex CLI. O Codex usa o mesmo pipeline de nota viva
// do Claude Code e do Antigravity (hooks/obsidian-vault-check.mjs): dump local
// garantido, narrativa por LLM num worker destacado, Daily cross-agente e
// taxonomia por projeto. Este arquivo só repassa o payload.
//
// Instalado em ~/.codex/hooks/; o instalador troca o marcador abaixo pela
// pasta real dos hooks do muri-saver (normalmente ~/.claude/hooks).

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const INSTALLED_HOOKS_DIR = '__MURI_SAVER_HOOKS_DIR__';

// Execuções headless do próprio muri-saver (muri-delegate, narrativa) não são
// sessões do usuário.
if (process.env.MURI_DELEGATE === '1' || process.env.MURI_SAVER_OBSIDIAN_GEN === '1') process.exit(0);

function vaultHookPath() {
  const candidates = [
    process.env.MURI_SAVER_VAULT_HOOK,
    INSTALLED_HOOKS_DIR.startsWith('__') ? null : join(INSTALLED_HOOKS_DIR, 'obsidian-vault-check.mjs'),
    join(dirname(dirname(fileURLToPath(import.meta.url))), 'obsidian-vault-check.mjs'), // layout do repo
    join(os.homedir(), '.claude', 'hooks', 'obsidian-vault-check.mjs'),
  ];
  return candidates.find((p) => p && existsSync(p)) || null;
}

const firstString = (...values) => values.find((v) => typeof v === 'string' && v.trim()) || '';

try {
  const raw = readFileSync(0, 'utf8').trim();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
  const sessionId = firstString(payload.session_id, payload.sessionId, payload.thread_id, payload.threadId, payload.conversation_id);
  const hook = vaultHookPath();
  if (sessionId && hook) {
    const r = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({
        agent: 'codex',
        session_id: sessionId,
        transcript_path: firstString(payload.transcript_path, payload.transcriptPath),
        cwd: firstString(payload.cwd, payload.working_directory, payload.workingDirectory, payload.context?.cwd),
        hook_event_name: firstString(payload.hook_event_name, process.argv[2]) || 'Stop',
      }),
      stdio: ['pipe', 'ignore', 'pipe'],
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
    });
    // O hook do vault nunca falha a sessão; avisos dele (vault inacessível) são repassados.
    if (r.stderr && r.stderr.trim()) process.stderr.write(`${r.stderr.trim()}\n`);
  }
} catch {
  // Nunca transforma falha do vault em falha do hook do Codex.
}
process.stdout.write('{}');
