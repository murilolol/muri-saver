import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskSecrets, stripSystemTags, escapeStrayHtml, sanitize, yamlQuote } from '../lib/sanitize.mjs';

test('masks common secret formats', () => {
  const out = maskSecrets([
    'anthropic sk-ant-api03-FAKEKEYFAKEKEYFAKEKEY123',
    'github ghp_FAKEFAKEFAKEFAKEFAKEFAKE1234',
    'aws AKIAABCDEFGHIJKLMNOP',
    'senha: hunter2hunter2',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
  ].join('\n'));
  assert.match(out, /REDACTED:ANTHROPIC_KEY/);
  assert.match(out, /REDACTED:GITHUB_TOKEN/);
  assert.match(out, /REDACTED:AWS_ACCESS_KEY_ID/);
  assert.match(out, /REDACTED:PASSWORD/);
  assert.match(out, /REDACTED:BEARER_TOKEN/);
  assert.doesNotMatch(out, /FAKEKEYFAKEKEY|hunter2|AKIAABCDEFGHIJKLMNOP/);
});

test('drops metadata blocks but keeps the text inside USER_REQUEST', () => {
  const out = stripSystemTags('<USER_REQUEST>\nfaz X\n</USER_REQUEST>\n<ADDITIONAL_METADATA>cursor on line 1</ADDITIONAL_METADATA>');
  assert.equal(out, 'faz X');
});

test('wraps stray HTML/JSX in inline code so Obsidian never renders it', () => {
  assert.equal(escapeStrayHtml('clique <button>aqui</button>'), 'clique `<button>`aqui`</button>`');
});

test('sanitize applies all passes in order', () => {
  const out = sanitize('<USER_REQUEST>token sk-ant-api03-FAKEKEYFAKEKEYFAKEKEY123 <div>x</div></USER_REQUEST>');
  assert.equal(out, 'token [REDACTED:ANTHROPIC_KEY] `<div>`x`</div>`');
});

test('yamlQuote escapes quotes, backslashes and newlines', () => {
  assert.equal(yamlQuote('a: "b"\nc\\d'), '"a: \\"b\\" c\\\\d"');
});
