import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  discoverClaude, discoverAntigravity, discoverCodex, parseSession, parseDesktopFile, projectLabelFromCwd, loadSqlite,
} from '../lib/parsers.mjs';
import { FIXTURE_HOME, FIXTURES, fixtureHome } from './_helpers.mjs';

test('claude: main session found, subagent transcript skipped unless asked', async () => {
  const res = discoverClaude(FIXTURE_HOME);
  assert.equal(res.refs.length, 1);
  assert.equal(res.skippedSubagents, 1);
  assert.equal(discoverClaude(FIXTURE_HOME, { includeSubagents: true }).refs.length, 2);
});

test('claude: parser drops command noise, tool results and sidechain chatter', async () => {
  const [ref] = discoverClaude(FIXTURE_HOME).refs;
  const parsed = await parseSession(ref);
  assert.equal(parsed.cwd, '/home/dev/demo-app');
  assert.equal(parsed.toolCallCount, 1);
  assert.deepEqual(parsed.exchanges.map((e) => e.role), ['user', 'assistant', 'user', 'assistant']);
  assert.ok(parsed.exchanges.every((e) => !e.text.includes('subagente interno') && !e.text.includes('/clear')));
});

test('antigravity: keeps real prompts/answers and infers cwd from tool calls', async () => {
  const [ref] = discoverAntigravity(FIXTURE_HOME).refs;
  const parsed = await parseSession(ref);
  assert.equal(parsed.exchanges.length, 4);
  assert.equal(parsed.toolCallCount, 1);
  assert.equal(projectLabelFromCwd(parsed.cwd), 'landing-page');
  assert.equal(parsed.startedAt, '2026-09-20T15:00:00-03:00');
});

test('codex: skips injected AGENTS.md/environment messages and developer role', async () => {
  const { refs } = await discoverCodex(FIXTURE_HOME);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].id, '7c7c7c7c-3333-4ccc-8ddd-444444444444');
  const parsed = await parseSession(refs[0]);
  assert.equal(parsed.exchanges.length, 4);
  assert.equal(parsed.exchanges[0].role, 'user');
  assert.match(parsed.exchanges[0].text, /^Adiciona rate limit/);
  assert.equal(parsed.toolCallCount, 1);
  assert.equal(projectLabelFromCwd(parsed.cwd), 'api-server');
});

test('desktop: tolerant parser handles text and content-block shapes, skips empty chats', () => {
  const { refs } = parseDesktopFile(join(FIXTURES, 'desktop', 'conversations.json'));
  assert.equal(refs.length, 2);
  assert.equal(refs[1].preParsed.exchanges[0].text, 'Qual a diferença entre Box e Rc?');
});

test('projectLabelFromCwd handles Windows paths and ignores home dirs', () => {
  assert.equal(projectLabelFromCwd('C:\\Users\\muri\\Documents\\site 2 com astra'), 'site 2 com astra');
  assert.equal(projectLabelFromCwd('/home/dev/demo-app/'), 'demo-app');
  assert.equal(projectLabelFromCwd('/Users/murilodev'), null);
  assert.equal(projectLabelFromCwd('C:\\Users\\muri'), null);
  assert.equal(projectLabelFromCwd(null), null);
});

test('codex SQLite: recovers threads without a rollout and skips subagents', async (t) => {
  const Db = await loadSqlite();
  if (!Db) return t.skip('node:sqlite indisponível neste Node');
  const home = fixtureHome();
  const codexDir = join(home, '.codex');
  const state = new Db(join(codexDir, 'state_5.sqlite'));
  state.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, created_at INTEGER, updated_at INTEGER, cwd TEXT, title TEXT, source TEXT)');
  const ins = state.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?)');
  ins.run('7c7c7c7c-3333-4ccc-8ddd-444444444444', '/gone.jsonl', 1789920000, 1789920300, 'C:\\Users\\dev\\Documents\\api-server', 'rate limit', '"cli"');
  ins.run('99999999-aaaa-4bbb-8ccc-dddddddddddd', '/deleted.jsonl', 1789830000, 1789830600, '/home/dev/old-project', 'thread antiga', '"cli"');
  ins.run('88888888-aaaa-4bbb-8ccc-dddddddddddd', '/sub.jsonl', 1789830000, 1789830600, '/home/dev/old-project', '', '{"subagent":{"thread_spawn":{"depth":1}}}');
  state.close();
  const hist = new Db(join(codexDir, 'thread_history_1.sqlite'));
  hist.exec('CREATE TABLE thread_items (thread_id TEXT, turn_id TEXT, item_id TEXT, rollout_ordinal INTEGER, created_at_ms INTEGER, item_json TEXT, item_type TEXT)');
  const item = hist.prepare('INSERT INTO thread_items VALUES (?, ?, ?, ?, ?, ?, ?)');
  item.run('99999999-aaaa-4bbb-8ccc-dddddddddddd', 't1', 'i1', 1, 1789830000000, JSON.stringify({ type: 'userMessage', content: [{ type: 'text', text: 'Migra o banco pra Postgres' }] }), 'userMessage');
  item.run('99999999-aaaa-4bbb-8ccc-dddddddddddd', 't1', 'i2', 2, 1789830005000, JSON.stringify({ type: 'commandExecution' }), 'commandExecution');
  item.run('99999999-aaaa-4bbb-8ccc-dddddddddddd', 't1', 'i3', 3, 1789830010000, JSON.stringify({ type: 'agentMessage', text: 'Migração criada em db/migrate/001.sql' }), 'agentMessage');
  item.run('88888888-aaaa-4bbb-8ccc-dddddddddddd', 't1', 'i1', 1, 1789830000000, JSON.stringify({ type: 'userMessage', content: [{ type: 'text', text: 'sub' }] }), 'userMessage');
  hist.close();

  const res = await discoverCodex(home);
  assert.equal(res.skippedSubagents, 1);
  const ids = res.refs.map((r) => r.id).sort();
  assert.deepEqual(ids, ['7c7c7c7c-3333-4ccc-8ddd-444444444444', '99999999-aaaa-4bbb-8ccc-dddddddddddd']);
  const fromDb = res.refs.find((r) => r.kind === 'codex-sqlite');
  const parsed = await parseSession(fromDb);
  assert.deepEqual(parsed.exchanges.map((e) => e.text), ['Migra o banco pra Postgres', 'Migração criada em db/migrate/001.sql']);
  assert.equal(parsed.toolCallCount, 1);
  const rollout = res.refs.find((r) => r.kind !== 'codex-sqlite');
  assert.equal(rollout.title, 'rate limit');
});
