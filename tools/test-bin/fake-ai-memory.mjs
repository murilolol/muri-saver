#!/usr/bin/env node
// `ai-memory` falso para os testes.
//   status --json            → {"data_dir": FAKE_AIM_DATA}
//   auto-improve --session-id <id>
//     id "fail*"    → falha da própria sessão (exit 1)
//     id "exhaust*" → cota acabou: grava "false" em FAKE_HEALTH_FILE e sai 1
//     outro         → ok
//   write-page / finalize-session → registra em FAKE_AIM_LOG e responde ok
import { appendFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (name) => args[args.indexOf(name) + 1];
if (process.env.FAKE_AIM_LOG) appendFileSync(process.env.FAKE_AIM_LOG, `${JSON.stringify(args)}\n`);

if (args[0] === 'status') {
  console.log(JSON.stringify({ version: '0.0.0-fake', data_dir: process.env.FAKE_AIM_DATA || '/nonexistent' }));
} else if (args[0] === 'auto-improve') {
  const sid = arg('--session-id');
  if (sid.startsWith('fail')) { console.error('erro da sessão'); process.exit(1); }
  if (sid.startsWith('exhaust')) {
    if (process.env.FAKE_HEALTH_FILE) writeFileSync(process.env.FAKE_HEALTH_FILE, 'false');
    console.error('llm fallback chain exhausted after 2 candidate(s)');
    process.exit(1);
  }
  console.log(`- ${sid} [approved] page fake`);
} else if (args[0] === 'finalize-session') {
  console.log(JSON.stringify({ finalized: arg('--session-id') }));
} else if (args[0] === 'write-page') {
  console.log('ok');
} else {
  process.exit(2);
}
