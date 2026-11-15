import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { mergeHooks, removeHooks, mergeAntigravityHooks, removeAntigravityHooks } from '../lib/hooks-merge.mjs';

const H = `${os.homedir()}/.claude/hooks`;
const SNIPPET = {
  Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'node', args: [`${H}/obsidian-vault-check.mjs`], statusMessage: 'novo' }] }],
  UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: 'python3', args: [`${H}/guarda-contexto.py`] }] }],
};
const USER_HOOK = { type: 'command', command: '/bin/ai-memory hook --event stop' };

test('merge dedups by script path: old forms are replaced, your hooks stay, and it is idempotent', () => {
  const existing = {
    Stop: [
      { matcher: '', hooks: [{ type: 'command', command: 'node', args: [`${H}/obsidian-vault-check.mjs`], statusMessage: 'antigo' }] },
      { matcher: '', hooks: [USER_HOOK, { type: 'command', command: `node "${H}/obsidian-vault-check.mjs"` }] },
    ],
    UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: 'python3 ~/.claude/hooks/guarda-contexto.py', timeout: 5 }] }],
    PreCompact: [{ matcher: '', hooks: [USER_HOOK] }],
  };
  const merged = mergeHooks(existing, SNIPPET);
  assert.deepEqual(merged.Stop, [SNIPPET.Stop[0], { matcher: '', hooks: [USER_HOOK] }], 'one vault hook, in the old place; the shared group keeps your hook');
  assert.deepEqual(merged.UserPromptSubmit, SNIPPET.UserPromptSubmit, '"python3 ~/x.py" in command is the same hook as args: [x.py]');
  assert.deepEqual(merged.PreCompact, existing.PreCompact);
  assert.deepEqual(mergeHooks(merged, SNIPPET), merged);

  const removed = removeHooks(existing, SNIPPET);
  assert.deepEqual(removed, { Stop: [{ matcher: '', hooks: [USER_HOOK] }], PreCompact: existing.PreCompact }, 'removal also catches the old forms');
});

test('Antigravity merge and removal use the script path too', () => {
  const snippet = { 'obsidian-vault-check': { Stop: [{ type: 'command', command: `node "${H}/obsidian-vault-check.mjs"`, timeout: 10 }] } };
  const existing = { 'obsidian-vault-check': { Stop: [{ type: 'command', command: `node ${H}/obsidian-vault-check.mjs` }, USER_HOOK] } };
  const merged = mergeAntigravityHooks(existing, snippet);
  assert.deepEqual(merged['obsidian-vault-check'].Stop, [snippet['obsidian-vault-check'].Stop[0], USER_HOOK]);
  assert.deepEqual(removeAntigravityHooks(merged, snippet), { 'obsidian-vault-check': { Stop: [USER_HOOK] } });
});
