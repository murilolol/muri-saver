import { mkdtempSync, cpSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
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
  'MURI_SAVER_CLAUDE_BIN', 'MURI_SAVER_AI_MEMORY_BIN', 'MURI_SAVER_AGY_BIN', 'MURI_SAVER_CODEX_BIN', 'MURI_SAVER',
  'MURI_SAVER_NARRATIVE_CHAIN', 'MURI_SAVER_AIM_CHAIN', 'MURI_SAVER_BACKFILL_CHAIN', 'MURI_SAVER_PLATFORM',
  'MURI_SAVER_RUNTIME_DIR', 'MURI_SAVER_RUNTIME_SCRIPTS_DIR', 'MURI_SAVER_STATE_DIR', 'MURI_SAVER_COOLDOWN_FILE',
  'MURI_DELEGATE', 'MURI_SAVER_OBSIDIAN_GEN', 'MURI_AIM_NOCAPTURE', 'MURI_VAULT_WORKER', 'MURI_VAULT_BACKFILL',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'AIM_SHIM_PORT', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
];

// Testes nunca registram jobs de verdade nem chamam um LLM: o agendador roda em
// modo "dry" (só grava os arquivos) e a cadeia de narrativa começa desligada.
// Um teste que precisa de LLM passa um provedor falso explicitamente.
export const HERMETIC_ENV = { MURI_SAVER_SCHEDULER: 'dry', MURI_SAVER_NARRATIVE_CHAIN: 'off', MURI_SAVER_AIM_CHAIN: 'off' };

export function cleanEnv(home, env = {}) {
  const base = { ...process.env };
  for (const k of LEAKY_ENV) delete base[k];
  return { ...base, HOME: home, USERPROFILE: home, ...HERMETIC_ENV, ...env };
}

export function run(script, args = [], { home, env = {}, input } = {}) {
  const res = spawnSync(process.execPath, [join(REPO_ROOT, script), ...args], {
    env: cleanEnv(home, env),
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

// Versão assíncrona: necessária quando o próprio teste sobe um servidor HTTP
// (ex.: um /health falso do shim) que o script filho consulta.
export function runAsync(script, args = [], { home, env = {}, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, script), ...args], { env: cleanEnv(home, env) });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout, stderr, out: stdout + stderr }));
    child.stdin.end(input || '');
  });
}
