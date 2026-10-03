import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run, tempDir, cleanEnv, REPO_ROOT } from './_helpers.mjs';
import { setTomlKey, TUNE } from '../scripts/ai-memory-llm-mode.mjs';
import { idleSessionsSql } from '../scripts/ai-memory-finalize-idle.mjs';
import { parseArgs, buildPrompt } from '../scripts/muri-delegate.mjs';
import { hasNarrative, countUserMessages } from '../scripts/vault-backfill.mjs';

test('aim-guard skips the wrapped command under MURI_AIM_NOCAPTURE and passes stdin through otherwise', () => {
  const guard = join(REPO_ROOT, 'hooks', 'aim-guard.mjs');
  const echo = ['-e', 'process.stdin.pipe(process.stdout)'];
  const skipped = spawnSync(process.execPath, [guard, '--', process.execPath, ...echo], { input: 'payload', encoding: 'utf8', env: { ...process.env, MURI_AIM_NOCAPTURE: '1' } });
  assert.equal(skipped.status, 0);
  assert.equal(skipped.stdout, '{}');
  const passed = spawnSync(process.execPath, [guard, '--', process.execPath, ...echo], { input: 'payload', encoding: 'utf8', env: cleanEnv(tempDir()) });
  assert.equal(passed.stdout, 'payload');
});

test('setTomlKey edits top-level and section keys, revives commented defaults and comments a key out', () => {
  const toml = '# llm_provider = "gemini"\nllm_model = "x"\n\n[auto_improve]\n# max_input_tokens = 24000\nmin_confidence = 0.75\n\n[auto_improve.scheduler]\ninterval_secs = 60\n';
  let out = setTomlKey(toml, '', 'llm_provider', '"openai-compat"');
  assert.match(out, /^llm_provider = "openai-compat"$/m);
  out = setTomlKey(out, 'auto_improve', 'max_input_tokens', '150000');
  assert.match(out, /\[auto_improve\]\nmax_input_tokens = 150000\nmin_confidence = 0\.75/);
  out = setTomlKey(out, 'auto_improve.scheduler', 'interval_secs', '300');
  assert.match(out, /\[auto_improve\.scheduler\]\ninterval_secs = 300/);
  assert.doesNotMatch(out, /interval_secs = 60/);
  out = setTomlKey(out, '', 'llm_model', null);
  assert.match(out, /^# llm_model = "x"$/m);
  out = setTomlKey(out, 'nova', 'chave', '1');
  assert.match(out, /\[nova\]\nchave = 1\n$/);
  assert.equal(TUNE.auto_improve.max_input_tokens, '150000');
});

test('finalize-idle SQL picks only open sessions idle past the threshold', async (t) => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { t.skip('node:sqlite indisponível nesta versão do Node'); return; }
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE workspaces (id BLOB, name TEXT); CREATE TABLE projects (id BLOB, name TEXT);
    CREATE TABLE sessions (id BLOB, agent_kind TEXT, workspace_id BLOB, project_id BLOB, started_at INTEGER, ended_at INTEGER);
    CREATE TABLE observations (session_id BLOB, created_at INTEGER);
    INSERT INTO workspaces VALUES (x'01', 'default'); INSERT INTO projects VALUES (x'02', 'app');`);
  const now = 1_800_000_000;
  const us = (s) => s * 1_000_000;
  const ins = db.prepare('INSERT INTO sessions VALUES (?, ?, x\'01\', x\'02\', ?, ?)');
  ins.run(Buffer.from('aa'.repeat(16), 'hex'), 'antigravity-cli', us(now - 10 * 3600), null); // ociosa
  ins.run(Buffer.from('bb'.repeat(16), 'hex'), 'claude-code', us(now - 10 * 3600), null); // tem observação recente
  ins.run(Buffer.from('cc'.repeat(16), 'hex'), 'codex', us(now - 10 * 3600), us(now - 9 * 3600)); // já encerrada
  db.prepare('INSERT INTO observations VALUES (?, ?)').run(Buffer.from('bb'.repeat(16), 'hex'), us(now - 600));
  const rows = db.prepare(idleSessionsSql(7200, now)).all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ agent: 'antigravity-cli', sid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', workspace: 'default', project: 'app' }]);
});

test('muri-delegate parses options, refuses recursion and builds a read-only brief', () => {
  const o = parseArgs(['codex', '--effort', 'low', '--lines', '20', 'revise', 'o diff']);
  assert.equal(o.agent, 'codex');
  assert.equal(o.effort, 'low');
  assert.equal(o.brief, 'revise o diff');
  assert.match(buildPrompt({ ...o, dir: '/x' }), /SOMENTE LEITURA[\s\S]*no máximo 20 linhas[\s\S]*revise o diff/);
  const r = run('scripts/muri-delegate.mjs', ['gemini', 'oi'], { home: tempDir(), env: { MURI_DELEGATE: '1' } });
  assert.equal(r.status, 64);
  const bad = run('scripts/muri-delegate.mjs', ['gemini', '--write', 'oi'], { home: tempDir() });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /escrita só via codex/);
});

test('vault-backfill knows which notes still need a narrative and skips trivial sessions', () => {
  assert.equal(hasNarrative('<!-- auto-narrativa:start -->\n_Narrativa pendente: x_\n<!-- auto-narrativa:end -->'), false);
  assert.equal(hasNarrative('<!-- auto-narrativa:start -->\n## 🧠 Narrativa — x\n<!-- auto-narrativa:end -->'), true);
  assert.equal(hasNarrative('## 📝 Síntese Executiva\n\nnota de versão antiga'), true);
  assert.equal(hasNarrative('# Sessão\n## 💬 Prompts & Respostas (dump local)'), false);
  const dir = tempDir();
  mkdirSync(dir, { recursive: true });
  const t = join(dir, 't.jsonl');
  writeFileSync(t, [
    { type: 'user', message: { content: '<command-name>/clear</command-name>' } },
    { type: 'user', message: { content: 'primeiro pedido' } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'user', message: { content: 'segundo pedido' } },
  ].map((o) => JSON.stringify(o)).join('\n'));
  assert.equal(countUserMessages(t, 'claude'), 2);
});
