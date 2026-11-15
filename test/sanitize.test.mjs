import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskSecrets, stripSystemTags, escapeStrayHtml, sanitize, yamlQuote } from '../lib/sanitize.mjs';
import { maskSecrets as hookMaskSecrets } from '../hooks/muri-common.mjs';

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

// hooks/muri-common.mjs keeps its own copy of the list (hooks never import lib/).
for (const [name, mask] of [['lib', maskSecrets], ['hooks', hookMaskSecrets]]) {
  test(`${name}: masks generic key=value secrets but leaves token counts alone`, () => {
    for (const s of ['api_key=abcd1234efgh5678', 'export MY_SERVICE_TOKEN="zz9-plural-z-alpha"', 'client_secret: s3cr3tValue99', '"access_token": "ya29.abcdefgh"', '"password": "hunter2hunter2"',
      `export ${'A'.repeat(50)}_TOKEN=abcd1234efgh5678`, '{\\"api_key\\": \\"abcd1234efgh5678\\"}', 'Authorization: Basic abcd1234efgh5678==']) {
      assert.match(mask(s), /REDACTED:(SECRET|PASSWORD)/, s);
      assert.doesNotMatch(mask(s), /abcd1234|zz9-plural|s3cr3t|ya29|hunter2/, s);
    }
    assert.equal(mask('GITHUB_TOKEN=ghp_FAKEFAKEFAKEFAKEFAKEFAKE1234'), 'GITHUB_TOKEN=[REDACTED:GITHUB_TOKEN]');
    assert.equal(mask('export MY_TOKEN="zz9-plural-z-alpha"'), 'export MY_TOKEN="[REDACTED:SECRET]"');
    for (const s of ['max_tokens=128000000', 'max_token=128000000', 'input_tokens: 123456789', 'token: curto', 'tokenizer=whatever123',
      'const token = getAuthToken();']) assert.equal(mask(s), s);
  });
}

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
