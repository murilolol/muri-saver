import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runAsync, tempDir, writeFile, REPO_ROOT } from './_helpers.mjs';
import { scanLogText } from '../scripts/ai-memory-reprocess-parked.mjs';

const FAKE_AIM = join(REPO_ROOT, 'tools', 'test-bin', 'fake-ai-memory.mjs');

// /health falso do shim: o arquivo de estado diz se há modelo livre.
function healthServer(stateFile) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const available = readFileSync(stateFile, 'utf8').trim() === 'true';
      res.end(JSON.stringify({ ok: true, chain: [{ model: 'fake:model', available }] }));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function scenario(rows, { available = true, preexistingPid = false } = {}) {
  const home = tempDir();
  const health = writeFile(join(home, 'health'), String(available));
  const server = await healthServer(health);
  const queue = join(home, '.claude', 'scripts', '.ai-memory-parked-queue.tsv');
  writeFile(queue, rows.map((r) => r.join('\t')).join('\n') + '\n');
  const plist = writeFile(join(home, 'Library', 'LaunchAgents', 'com.muri-saver.reprocess-parked.plist'), '<plist/>');
  writeFile(join(home, '.claude', 'muri-saver.json'), JSON.stringify({ llm: { shim: true } }));
  if (preexistingPid) writeFile(join(home, '.claude', 'scripts', '.ai-memory-reprocess.pid'), String(process.pid));
  const r = await runAsync('scripts/ai-memory-reprocess-parked.mjs', ['--sleep', '0'], {
    home,
    env: {
      MURI_SAVER_AI_MEMORY_BIN: FAKE_AIM, FAKE_HEALTH_FILE: health, AIM_SHIM_PORT: String(server.address().port),
      MURI_SAVER_PLATFORM: 'darwin', MURI_SAVER_CONFIG: join(home, '.claude', 'muri-saver.json'),
    },
  });
  server.close();
  const log = existsSync(join(home, '.claude', 'hooks', '.ai-memory-reprocess.log'))
    ? readFileSync(join(home, '.claude', 'hooks', '.ai-memory-reprocess.log'), 'utf8') : '';
  const left = existsSync(queue) ? readFileSync(queue, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')[0]) : [];
  return { r, log, left, plist, home };
}

test('ok / fail / ok → failures get one more pass → job disables itself', async () => {
  const { r, log, left, plist, home } = await scenario([['a1', 'default', 'p'], ['fail1', 'default', 'p'], ['c1', 'default', 'p']]);
  assert.equal(r.status, 0, r.out);
  assert.match(log, /ok a1 \[p\]/);
  assert.match(log, /devolvendo 1 falhas para uma segunda passada/);
  assert.match(log, /fila vazia, desativando o job reprocess-parked/);
  assert.deepEqual(left, []);
  assert.equal(existsSync(plist), false);
  assert.ok(existsSync(`${plist}.disabled`));
  assert.match(readFileSync(join(home, '.claude', 'scripts', '.ai-memory-parked-failed.tsv'), 'utf8'), /^fail1\t/);
});

test('no free model at start → exit 75 without touching the queue', async () => {
  const { r, log, left } = await scenario([['a1', 'default', 'p']], { available: false });
  assert.equal(r.status, 75);
  assert.match(log, /cadeia em cooldown/);
  assert.deepEqual(left, ['a1']);
});

test('quota runs out mid-run → the session stays at the head of the queue', async () => {
  const { r, log, left } = await scenario([['a1', 'default', 'p'], ['exhaust1', 'default', 'p'], ['c1', 'default', 'p']]);
  assert.equal(r.status, 75);
  assert.match(log, /cadeia esgotada em exhaust1/);
  assert.deepEqual(left, ['exhaust1', 'c1']);
});

test('three failures in a row look systemic → stop', async () => {
  const { r, log, left } = await scenario([['fail1', 'd', 'p'], ['fail2', 'd', 'p'], ['fail3', 'd', 'p'], ['d1', 'd', 'p']]);
  assert.equal(r.status, 75);
  assert.match(log, /3 falhas seguidas/);
  assert.deepEqual(left, ['d1']);
});

test('another live instance holds the lock → exit 0 quietly', async () => {
  const { r, left } = await scenario([['a1', 'd', 'p']], { preexistingPid: true });
  assert.equal(r.status, 0);
  assert.deepEqual(left, ['a1']);
});

test('legacy 2-column queue rows still work', async () => {
  const { r, log } = await scenario([['a1', 'meu projeto']]);
  assert.equal(r.status, 0, r.out);
  assert.match(log, /ok a1 \[meu projeto\]/);
});

test('scan keeps parked sessions that never completed later, even with spaces in the project', () => {
  const state = scanLogText([
    '2026-10-03T18:11:34Z WARN x: scheduled auto-improve failed workspace=default project=og roleplay session_id=fb23a8e6-10f2-405e-804a-35201804b667 error=llm fallback chain exhausted attempts=3 parked=true',
    '2026-10-03T18:11:35Z WARN x: scheduled auto-improve failed workspace=default project=trabalho session_id=554cae77-b3a5-4521-9d8b-e2e29175446a error=x attempts=1 parked=false',
    '2026-10-03T18:12:00Z WARN x: scheduled auto-improve failed workspace=default project=app session_id=01a0bfbd-f944-78d1-926f-7e092aeea18c error=x parked=true',
    '2026-10-03T19:00:00Z INFO x: scheduled auto-improve completed workspace=default project=app session_id=01a0bfbd-f944-78d1-926f-7e092aeea18c run_id=1',
  ].join('\n'));
  assert.deepEqual(state.get('fb23a8e6-10f2-405e-804a-35201804b667'), { status: 'parked', workspace: 'default', project: 'og roleplay' });
  assert.equal(state.get('01a0bfbd-f944-78d1-926f-7e092aeea18c').status, 'done');
  assert.equal(state.has('554cae77-b3a5-4521-9d8b-e2e29175446a'), false);
});

test('first run without a queue builds it from the ai-memory logs', async () => {
  const home = tempDir();
  const data = join(home, 'aim-data');
  mkdirSync(join(data, 'logs'), { recursive: true });
  writeFileSync(join(data, 'logs', 'ai-memory.log.2026-10-03'),
    '2026-10-03T18:11:34Z WARN x: scheduled auto-improve failed workspace=default project=app session_id=fb23a8e6-10f2-405e-804a-35201804b667 error=x parked=true\n');
  const r = await runAsync('scripts/ai-memory-reprocess-parked.mjs', ['--scan'], {
    home, env: { MURI_SAVER_AI_MEMORY_BIN: FAKE_AIM, FAKE_AIM_DATA: data },
  });
  assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(join(home, '.claude', 'scripts', '.ai-memory-parked-queue.tsv'), 'utf8'), 'fb23a8e6-10f2-405e-804a-35201804b667\tdefault\tapp\n');
});
