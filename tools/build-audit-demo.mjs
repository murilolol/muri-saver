#!/usr/bin/env node
// Render real audit output from synthetic data; never read the user's home.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { ansiToSvg } from './ansi-to-svg.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const demoHome = mkdtempSync(join(os.tmpdir(), 'muri-audit-demo-'));
const transcript = join(demoHome, 'demo-session.jsonl');
const rows = [
  { type: 'assistant', message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 30, cache_read_input_tokens: 50, cache_creation_input_tokens: 20 }, content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/demo/app.js' } }] } },
  { type: 'assistant', message: { id: 'm2', usage: { input_tokens: 80, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: 'tool_use', id: 'r2', name: 'Read', input: { file_path: '/demo/app.js' } }] } },
];
writeFileSync(transcript, rows.map(JSON.stringify).join('\n') + '\n');
const result = spawnSync(process.execPath, [join(root, 'bin', 'cli.mjs'), 'audit', '--file', transcript, '--agent', 'claude', '--source-home', demoHome], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || 'audit demo failed');
// Wrap plain CLI output to fit the same terminal style used by the README.
const wrapped = result.stdout.split('\n').flatMap((line) => {
  const lines = [];
  while (line.length > 104) {
    const space = line.lastIndexOf(' ', 104);
    const at = space > 0 ? space : 104;
    lines.push(line.slice(0, at));
    line = line.slice(at).trimStart();
  }
  return [...lines, line];
}).join('\n');
const svg = ansiToSvg('$ muri-saver audit --file demo-session.jsonl --agent claude\n\n' + wrapped, { title: 'Local audit · synthetic demo data', fontSize: 13 });
writeFileSync(join(root, 'assets', 'terminal-audit.svg'), svg);
console.log('assets/terminal-audit.svg');
