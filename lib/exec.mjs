import { execFileSync } from 'node:child_process';

// Runs an external CLI (claude, ai-memory). A path ending in .mjs/.cjs/.js is
// run through the current Node binary, which lets tests and power users point
// MURI_SAVER_CLAUDE_BIN / MURI_SAVER_AI_MEMORY_BIN at a script on any OS
// (Windows can't execute a .mjs directly, and a .cmd shim would mangle args).
export function execTool(bin, args, opts = {}) {
  if (/\.(mjs|cjs|js)$/i.test(bin)) return execFileSync(process.execPath, [bin, ...args], opts);
  return execFileSync(bin, args, opts);
}
