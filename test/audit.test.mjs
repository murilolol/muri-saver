import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, tempDir, writeFile } from './_helpers.mjs';
import { privatePath } from '../lib/audit.mjs';

function audit(rows, agent) {
  const home = tempDir();
  const file = writeFile(join(home, 'session.jsonl'), rows.map(JSON.stringify).join('\n') + '\n');
  const before = readdirSync(home);
  const r = run('bin/cli.mjs', ['audit', '--file', file, '--agent', agent, '--json'], { home });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(readdirSync(home), before, 'audit must not write session, config or vault files');
  return JSON.parse(r.stdout);
}

test('audit counts Claude usage once per message and never exposes prompts or tool arguments', () => {
  const tool = { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/demo/app.js', password: 'secret-value' } };
  const rows = [
    { type: 'user', message: { content: 'private prompt secret-value' } },
    { type: 'assistant', message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 50, cache_creation_input_tokens: 20 }, content: [tool] } },
    { type: 'assistant', message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 30, cache_read_input_tokens: 50, cache_creation_input_tokens: 20 }, content: [tool] } },
    { type: 'assistant', message: { id: 'm2', content: [{ ...tool, id: 'read-2' }] } },
  ];
  const report = audit(rows, 'claude');
  const s = report.sessions[0];
  assert.deepEqual(s.tokens, { input: 170, cachedInput: 50, cacheCreation: 20, output: 30, total: 200, source: 'claude-message-usage', inputComplete: true });
  assert.equal(s.toolCalls, 2);
  assert.equal(s.repeatedCalls[0].count, 2);
  assert.equal(s.repeatedCalls[0].tool, 'Read');
  assert.equal(JSON.stringify(report).includes('secret-value'), false);
  assert.equal(JSON.stringify(report).includes('private prompt'), false);
});

test('audit uses Codex cumulative usage without adding cached or reasoning tokens twice', () => {
  const usage = (input, cached, output) => ({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: 20, total_tokens: input + output }, last_token_usage: { input_tokens: 200, output_tokens: 40 } } } });
  const s = audit([usage(500, 200, 50), usage(1000, 400, 100), usage(1000, 400, 100)], 'codex').sessions[0];
  assert.deepEqual(s.tokens, { input: 1000, cachedInput: 400, cacheCreation: null, output: 100, total: 1100, source: 'codex-cumulative-usage', inputComplete: true });
  assert.equal(s.peakRequestInput, 200);
});

test('audit reports unavailable usage and treats reads after edits as new work', () => {
  const call = (id, name) => ({ type: 'response_item', payload: { type: 'function_call', call_id: id, name, arguments: JSON.stringify({ file_path: '/demo/app.js' }) } });
  const s = audit([call('1', 'read_file'), call('2', 'apply_patch'), call('3', 'read_file')], 'codex').sessions[0];
  assert.equal(s.tokens, null);
  assert.deepEqual(s.repeatedCalls, []);
  assert.equal(s.toolCalls, 3);
});

test('Antigravity writes invalidate repeated reads', () => {
  const call = (id, name) => ({ type: 'PLANNER_RESPONSE', tool_calls: [{ id, name, args: { AbsolutePath: '/demo/a.js' } }] });
  const s = audit([call('1', 'view_file'), call('2', 'write_to_file'), call('3', 'view_file')], 'antigravity').sessions[0];
  assert.deepEqual(s.repeatedCalls, []);
});

test('audit errors do not echo unknown argument values', () => {
  const r = run('bin/cli.mjs', ['audit', '--password=secret-value'], { home: tempDir() });
  assert.equal(r.status, 1);
  assert.equal(r.out.includes('secret-value'), false);
});

test('missing Claude cache counters stay unknown and mark input totals as partial', () => {
  const s = audit([{ type: 'assistant', message: { id: 'm1', usage: { input_tokens: 10, output_tokens: 2 } } }], 'claude').sessions[0];
  assert.equal(s.tokens.cachedInput, null);
  assert.equal(s.tokens.cacheCreation, null);
  assert.equal(s.tokens.inputComplete, false);
  assert.equal(s.tokens.total, 12);
});

test('path privacy does not corrupt paths when no home prefix is supplied', () => {
  assert.equal(privatePath('/demo/session.jsonl', ''), '/demo/session.jsonl');
});

test('audit extracts Antigravity calls and tolerates malformed lines without inventing usage', () => {
  const home = tempDir();
  const file = writeFile(join(home, 'session.jsonl'), '{broken\n' + JSON.stringify({ type: 'PLANNER_RESPONSE', tool_calls: [{ id: '1', name: 'view_file', args: { AbsolutePath: '/demo/a.js' } }] }) + '\n');
  const r = run('bin/cli.mjs', ['audit', '--file', file, '--agent', 'antigravity', '--json'], { home });
  assert.equal(r.status, 0, r.out);
  const s = JSON.parse(r.stdout).sessions[0];
  assert.equal(s.toolCalls, 1);
  assert.equal(s.invalidLines, 1);
  assert.equal(s.tokens, null);
});

test('instruction audit measures files and detects duplicates without returning their content', () => {
  const home = tempDir();
  writeFile(join(home, '.claude', 'CLAUDE.md'), '# Rules\nsecret-value\n');
  writeFile(join(home, 'AGENTS.md'), '# Rules\nsecret-value\n');
  const r = run('bin/cli.mjs', ['audit', '--instructions-only', '--json'], { home });
  assert.equal(r.status, 0, r.out);
  const report = JSON.parse(r.stdout);
  assert.equal(report.instructions.files.length, 2);
  assert.equal(report.instructions.duplicates.length, 1);
  assert.equal(JSON.stringify(report).includes('secret-value'), false);
  assert.equal(JSON.stringify(report).includes(home), false);
});

test('audit refuses missing files and invalid arguments instead of returning a successful empty report', () => {
  const home = tempDir();
  for (const args of [['--file', join(home, 'missing.jsonl')], ['--limit', '0'], ['--agent', 'unknown'], ['--unexpected']]) {
    const r = run('bin/cli.mjs', ['audit', ...args], { home });
    assert.equal(r.status, 1, r.out);
  }
});

test('audit discovery limits sessions, skips subagents and keeps the source unchanged', () => {
  const home = tempDir();
  const row = JSON.stringify({ type: 'assistant', message: { id: 'm', usage: { input_tokens: 10, output_tokens: 2 }, content: [] } });
  const file = writeFile(join(home, '.claude', 'projects', 'demo', 'one.jsonl'), row);
  writeFile(join(home, '.claude', 'projects', 'demo', 'two.jsonl'), row);
  writeFile(join(home, '.claude', 'projects', 'demo', 'one', 'subagents', 'agent-sub.jsonl'), row);
  const r = run('bin/cli.mjs', ['audit', '--agent', 'claude', '--limit', '1', '--json'], { home });
  assert.equal(r.status, 0, r.out);
  const report = JSON.parse(r.stdout);
  assert.equal(report.sessions.length, 1);
  assert.equal(report.skippedSubagents, 1);
  assert.equal(readFileSync(file, 'utf8'), row);
});
