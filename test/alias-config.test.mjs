import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAlias, renderWithAlias, applyAliasForms } from '../lib/alias.mjs';
import { resolveVault, resolveTimezone, isValidTimezone, configPath } from '../lib/config.mjs';
import { join } from 'node:path';

const SKILL = `---
name: muri-saver
description: Ao digitar "muri saver", "muri-saver" ou "/muri-saver" o modo liga.
---

# muri-saver

## Modo Sticky Muri-Saver
`;

test('default alias leaves content untouched', () => {
  assert.equal(renderWithAlias(SKILL, 'muri-saver'), SKILL);
});

test('custom alias renames every form and keeps muri-saver as alternate', () => {
  const out = renderWithAlias(SKILL, 'mendes-saver');
  assert.match(out, /^---\nname: mendes-saver\n/);
  assert.match(out, /"mendes saver", "mendes-saver" ou "\/mendes-saver"/);
  assert.match(out, /Modo Sticky Mendes-Saver/);
  assert.match(out, /"muri-saver"\/"muri saver"\/"\/muri-saver" continuam funcionando/);
});

test('single-word alias does not repeat the same trigger twice', () => {
  const out = applyAliasForms(SKILL, 'lucas');
  assert.match(out, /Ao digitar "lucas" ou "\/lucas"/);
  const note = renderWithAlias(SKILL, 'lucas');
  assert.match(note, /Gatilhos: "lucas", "\/lucas"/);
});

test('sanitizeAlias normalizes accents, spaces and casing', () => {
  assert.equal(sanitizeAlias('João Saver'), 'joao-saver');
  assert.equal(sanitizeAlias('  '), 'muri-saver');
});

test('vault precedence: flag > OBSIDIAN_VAULT > config > default', () => {
  const home = '/h';
  assert.equal(resolveVault({ cliVault: '/flag', env: { OBSIDIAN_VAULT: '/env' }, config: { vault: '/cfg' }, home }), '/flag');
  assert.equal(resolveVault({ env: { OBSIDIAN_VAULT: '/env' }, config: { vault: '/cfg' }, home }), '/env');
  assert.equal(resolveVault({ env: {}, config: { vault: '/cfg' }, home }), '/cfg');
  assert.equal(resolveVault({ env: {}, config: null, home }), join('/h', 'Documents', 'Obsidian Vault'));
});

test('timezone falls back past invalid values', () => {
  assert.equal(isValidTimezone('Not/AZone'), false);
  assert.equal(resolveTimezone({ cliTimezone: 'Not/AZone', env: {}, config: { timezone: 'Asia/Tokyo' } }), 'Asia/Tokyo');
});

test('MURI_SAVER_CONFIG overrides the config location', () => {
  assert.equal(configPath({ env: { MURI_SAVER_CONFIG: '/x/cfg.json' } }), '/x/cfg.json');
});
