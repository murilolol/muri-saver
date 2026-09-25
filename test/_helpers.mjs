import { mkdtempSync, cpSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = join(REPO_ROOT, 'test', 'fixtures');
export const FIXTURE_HOME = join(FIXTURES, 'home');

export function tempDir(prefix = 'muri-saver-test-') {
  return mkdtempSync(join(os.tmpdir(), prefix));
}

// A writable copy of the fixture home, so tests never touch the real one.
export function fixtureHome() {
  const dir = tempDir();
  cpSync(FIXTURE_HOME, dir, { recursive: true });
  return dir;
}

const LEAKY_ENV = [
  'OBSIDIAN_VAULT', 'MURI_SAVER_CONFIG', 'MURI_SAVER_TZ', 'MURI_SAVER_NOW',
  'MURI_SAVER_CLAUDE_BIN', 'MURI_SAVER_AI_MEMORY_BIN', 'MURI_SAVER',
];

export function run(script, args = [], { home, env = {}, input } = {}) {
  const base = { ...process.env };
  for (const k of LEAKY_ENV) delete base[k];
  const res = spawnSync(process.execPath, [join(REPO_ROOT, script), ...args], {
    env: { ...base, HOME: home, USERPROFILE: home, ...env },
    input,
    encoding: 'utf8',
    timeout: 60000,
  });
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  return { status: res.status, stdout, stderr, out: stdout + stderr };
}

export function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}
