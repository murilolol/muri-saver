import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

// Runs an external CLI (claude, ai-memory). A path ending in .mjs/.cjs/.js is
// run through the current Node binary, which lets tests and power users point
// MURI_SAVER_CLAUDE_BIN / MURI_SAVER_AI_MEMORY_BIN at a script on any OS
// (Windows can't execute a .mjs directly, and a .cmd shim would mangle args).
export function execTool(bin, args, opts = {}) {
  if (/\.(mjs|cjs|js)$/i.test(bin)) return execFileSync(process.execPath, [bin, ...args], opts);
  return execFileSync(bin, args, opts);
}

const onPath = (name) => (process.env.PATH || '').split(delimiter).filter(Boolean).some((dir) => {
  try {
    accessSync(join(dir, name), constants.X_OK);
    return true;
  } catch {
    return false;
  }
});

// Primeiro Python do PATH. No Windows costuma existir só `python` ou `py`, e
// `python3` lá às vezes é o atalho da Microsoft Store, por isso ele é executado.
// Fora do Windows o PATH só é lido: no macOS sem Command Line Tools,
// `python3 --version` abre o diálogo de instalação das ferramentas.
export function findPython() {
  if (process.platform !== 'win32') return ['python3', 'python'].find(onPath) || null;
  return ['python', 'py', 'python3'].find((n) => spawnSync(n, ['--version'], { stdio: 'ignore', windowsHide: true }).status === 0) || null;
}
