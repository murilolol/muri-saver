#!/usr/bin/env node
// Guarda dos hooks do ai-memory no Antigravity.
//
// O muri-saver chama o `agy` headless (narrativa do vault, cadeia do ai-memory,
// muri-delegate). Cada chamada dispara os hooks do próprio Antigravity, e o
// ai-memory registraria uma sessão-lixo para cada uma (cwd temporário, sem
// conteúdo útil). Esses processos rodam com MURI_AIM_NOCAPTURE=1.
//
// O instalador embrulha os comandos do grupo "ai-memory" do
// ~/.gemini/config/hooks.json assim:
//   node <hooks>/aim-guard.mjs -- <comando original do ai-memory>
// Sem MURI_AIM_NOCAPTURE=1, o comando original roda com o mesmo stdin/stdout.
// Com ele, o guard sai com 0 sem rodar nada. Funciona igual no macOS, Linux e
// Windows (não depende de `[ ... ] ||` do sh nem do cmd.exe).

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sep = process.argv.indexOf('--');
const cmd = sep === -1 ? process.argv.slice(2) : process.argv.slice(sep + 1);

if (process.env.MURI_AIM_NOCAPTURE === '1' || cmd.length === 0) {
  process.stdout.write('{}');
  process.exit(0);
}

let input = '';
try {
  input = readFileSync(0);
} catch {
  input = '';
}
const r = spawnSync(cmd[0], cmd.slice(1), { input, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
process.exit(r.status ?? 0);
