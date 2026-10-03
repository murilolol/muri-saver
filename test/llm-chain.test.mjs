import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir, REPO_ROOT } from './_helpers.mjs';

// O módulo lê o caminho do arquivo de cooldown na importação.
const COOLDOWNS = join(tempDir(), 'cooldowns.json');
process.env.MURI_SAVER_COOLDOWN_FILE = COOLDOWNS;
delete process.env.MURI_SAVER_NARRATIVE_CHAIN;
delete process.env.MURI_SAVER_AIM_CHAIN;
delete process.env.MURI_SAVER_BACKFILL_CHAIN;
const llm = await import('../hooks/muri-llm.mjs');

// Endpoint OpenAI-compatível falso: responde conforme o modelo pedido.
function fakeOpenAi() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        const { model } = JSON.parse(body);
        if (model === 'limitado') { res.writeHead(429); return res.end('{"error":"rate limit"}'); }
        if (model === 'quebrado') { res.writeHead(500); return res.end('boom'); }
        if (model === 'prosa') return res.end(JSON.stringify({ choices: [{ message: { content: 'não sei fazer JSON' } }] }));
        return res.end(JSON.stringify({ choices: [{ message: { content: '```json\n{"ok":true}\n```' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('parseEntry understands kind:model@timeout and the legacy "api:" prefix', () => {
  assert.deepEqual(llm.parseEntry('agy:gemini-3.1-pro-high@60'), { kind: 'agy', model: 'gemini-3.1-pro-high', timeoutMs: 60000, key: 'agy:gemini-3.1-pro-high' });
  assert.equal(llm.parseEntry('api:gemini-2.5-flash').kind, 'gemini-api');
  assert.equal(llm.parseEntry('nada'), null);
  assert.equal(llm.parseEntry('foo:bar'), null);
});

test('resolveChain: env beats config beats default; "off" empties it; backfill uses the first narrative model', () => {
  const cfg = { llm: { narrative: ['agy:a', 'agy:b'] } };
  assert.deepEqual(llm.resolveChain('narrative', cfg).map((e) => e.key), ['agy:a', 'agy:b']);
  assert.deepEqual(llm.resolveChain('backfill', cfg).map((e) => e.key), ['agy:a']);
  assert.ok(llm.resolveChain('aiMemory', {}).length >= 3, 'default aiMemory chain');
  process.env.MURI_SAVER_NARRATIVE_CHAIN = 'off';
  assert.deepEqual(llm.resolveChain('narrative', cfg), []);
  process.env.MURI_SAVER_NARRATIVE_CHAIN = 'claude:claude-haiku-4-5';
  assert.deepEqual(llm.resolveChain('narrative', cfg).map((e) => e.key), ['claude:claude-haiku-4-5']);
  delete process.env.MURI_SAVER_NARRATIVE_CHAIN;
});

test('complete() walks the chain: 429 and 5xx cool the model down, invalid JSON moves on, missing key is skipped', async () => {
  const server = await fakeOpenAi();
  const cfg = { llm: { openai: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } };
  const chain = ['gemini-api:sem-chave', 'openai:limitado', 'openai:quebrado', 'openai:prosa', 'openai:bom'].map(llm.parseEntry);
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const r = await llm.complete({ messages: [{ role: 'user', content: 'oi' }], json: true }, { chain, cfg });
  server.close();
  if (saved) process.env.GEMINI_API_KEY = saved;
  assert.equal(r.model, 'openai:bom');
  assert.equal(r.text, '{"ok":true}', 'code fences are stripped and JSON is normalized');
  assert.deepEqual(r.tried, [
    'gemini-api:sem-chave=indisponivel', 'openai:limitado=429', 'openai:quebrado=500', 'openai:prosa=json-invalido',
  ]);
  const cd = JSON.parse(readFileSync(COOLDOWNS, 'utf8'));
  assert.ok(cd['openai:limitado'].until > Date.now());
  assert.ok(cd['openai:quebrado'].until > Date.now());
  assert.equal(cd['openai:prosa'], undefined, 'a bad answer is not a quota problem');

  const again = await llm.complete({ messages: [{ role: 'user', content: 'oi' }] }, { chain: [llm.parseEntry('openai:limitado')], cfg });
  assert.equal(again.error, true);
  assert.deepEqual(again.tried, ['openai:limitado=cooldown']);
  assert.equal(llm.triedOnlyQuota(again.tried), true);
  assert.equal(llm.triedOnlyQuota(['openai:prosa=json-invalido']), false);
});

test('agy provider talks stream-json over stdin (works with long prompts on every OS)', async () => {
  process.env.MURI_SAVER_AGY_BIN = join(REPO_ROOT, 'tools', 'test-bin', 'fake-agy.mjs');
  const r = await llm.complete({ messages: [{ role: 'user', content: 'x'.repeat(300000) }], json: true }, { chain: [llm.parseEntry('agy:fake')], cfg: {} });
  delete process.env.MURI_SAVER_AGY_BIN;
  assert.equal(r.model, 'agy:fake', JSON.stringify(r));
  assert.equal(JSON.parse(r.text).titulo_curto, 'Botão de login corrigido no mobile');
});

test('API keys can come from a KEY=value file (schedulers do not read the shell profile)', () => {
  const file = join(tempDir(), 'llm.env');
  writeFileSync(file, 'export GEMINI_API_KEY="abc123"\nOUTRA=1\n');
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  assert.equal(llm.envValue('GEMINI_API_KEY', { llm: { apiKeyFile: file } }), 'abc123');
  assert.equal(llm.isAvailable(llm.parseEntry('gemini-api:x'), { llm: { apiKeyFile: file } }), true);
  if (saved) process.env.GEMINI_API_KEY = saved;
});

test('the Gemini free-tier reset is computed in Pacific time', () => {
  const ms = llm.msUntilPacificMidnight(new Date('2026-07-01T06:00:00Z')); // 23:00 PDT
  assert.equal(Math.round(ms / 60000), 65);
});
