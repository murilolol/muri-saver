#!/usr/bin/env node
// SessionStart hook: makes sure the local ai-memory server is up before
// Claude Code's own SessionStart hook (installed by `ai-memory install-hooks`)
// tries to fetch a handoff from it. Started on demand per Claude Code
// session instead of at Windows login, per user preference.
//
// Never blocks/fails the session: any error here is swallowed and the hook
// exits 0, same contract as the impeccable hook.

import net from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const HOST = '127.0.0.1';
const PORT = 49374;
const EXE = process.platform === 'win32'
  ? join(os.homedir(), '.cargo', 'bin', 'ai-memory.exe')
  : (existsSync(join(os.homedir(), '.local', 'bin', 'ai-memory'))
      ? join(os.homedir(), '.local', 'bin', 'ai-memory')
      : 'ai-memory');
const ARGS = ['serve', '--transport', 'http', '--bind', `${HOST}:${PORT}`, '--enable-web'];

function isServerUp(timeoutMs = 300) {
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
    socket.connect(PORT, HOST);
  });
}

function warnIfHomeDir() {
  // ai-memory's project_strategy=repo-root buckets every observation by cwd.
  // Opening Claude Code directly in the home dir (then /add-dir into a real
  // project) never changes the process cwd, so everything lands in one
  // generic project forever. Surface this to the agent via additionalContext
  // so it can tell the user instead of failing silently.
  try {
    const cwd = process.cwd().replace(/[\\/]+$/, '').toLowerCase();
    const home = os.homedir().replace(/[\\/]+$/, '').toLowerCase();
    if (home && cwd === home) {
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext:
            'ai-memory warning: this session started in the home directory ' +
            `(${os.homedir()}), not inside a project. project_strategy=repo-root ` +
            'means every observation will land in one generic "muri" project ' +
            'instead of the real project\'s bucket, even after /add-dir. Tell the ' +
            'user to close this session and reopen with `cd <project> && claude` ' +
            'instead.',
        },
      }));
    }
  } catch {
    // Best-effort only.
  }
}

async function main() {
  try {
    const up = await isServerUp();
    if (!up) {
      const child = spawn(EXE, ARGS, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
    }
  } catch {
    // Swallow: never break session start because of this.
  }
  warnIfHomeDir();
  process.exit(0);
}

main();
