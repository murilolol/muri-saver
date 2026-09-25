import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, appendFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { run, tempDir } from './_helpers.mjs';

function freshHome() {
  const home = tempDir();
  mkdirSync(join(home, '.codex'), { recursive: true });
  mkdirSync(join(home, '.gemini'), { recursive: true });
  return home;
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

test('install writes files, config with manifest, and merged hooks for all agents', () => {
  const home = freshHome();
  const vault = join(home, 'vault');
  const r = run('bin/install.mjs', ['--vault', vault, '--timezone', 'America/Sao_Paulo'], { home });
  assert.equal(r.status, 0, r.out);
  const cfg = readJson(join(home, '.claude', 'muri-saver.json'));
  assert.equal(cfg.alias, 'muri-saver');
  assert.equal(cfg.vault, vault);
  assert.equal(cfg.timezone, 'America/Sao_Paulo');
  assert.deepEqual(cfg.agents, ['claude', 'codex', 'antigravity']);
  assert.ok(cfg.manifest.length >= 10);
  assert.ok(existsSync(join(home, '.agents', 'skills', 'muri-saver', 'SKILL.md')));
  assert.ok(existsSync(join(home, '.claude', 'CLAUDE.md')));
  assert.ok(existsSync(join(home, '.codex', 'AGENTS.md')));
  assert.ok(existsSync(join(home, '.gemini', 'GEMINI.md')));
  assert.ok(existsSync(join(vault, 'codex', 'dailies')));
  const settings = readJson(join(home, '.claude', 'settings.json'));
  assert.match(JSON.stringify(settings.hooks.Stop), /obsidian-vault-check\.mjs/);
  assert.ok(settings.statusLine);
  const gemini = readJson(join(home, '.gemini', 'config', 'hooks.json'));
  assert.ok(gemini['obsidian-vault-check'].Stop.length === 1);
});

test('re-running install is a no-op: nothing written, no backups', () => {
  const home = freshHome();
  run('bin/install.mjs', [], { home });
  const r = run('bin/install.mjs', [], { home });
  assert.match(r.out, /Pronto: 0 arquivo\(s\) criado\(s\)\/atualizado\(s\), \d+ já em dia, 0 backup\(s\)/);
  assert.equal(existsSync(join(home, '.claude', 'muri-saver-backups')), false);
});

test('switching alias renames the skill and moves the old folder to the backup dir', () => {
  const home = freshHome();
  run('bin/install.mjs', [], { home });
  const r = run('bin/install.mjs', ['--alias', 'lucas'], { home });
  assert.equal(r.status, 0, r.out);
  const skills = readdirSync(join(home, '.agents', 'skills')).sort();
  assert.deepEqual(skills, ['grill-me', 'lucas']);
  assert.match(readFileSync(join(home, '.agents', 'skills', 'lucas', 'SKILL.md'), 'utf8'), /^---\nname: lucas\n/);
  assert.match(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8'), /Alias personalizado/);
});

test('--update keeps a CLAUDE.md you edited and refreshes nothing else unnecessarily', () => {
  const home = freshHome();
  run('bin/install.mjs', ['--timezone', 'Asia/Tokyo'], { home });
  appendFileSync(join(home, '.claude', 'CLAUDE.md'), '\n# minha regra\n');
  const r = run('bin/install.mjs', ['--update'], { home });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /reaproveitando a config salva/);
  assert.match(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8'), /# minha regra/);
  assert.equal(readJson(join(home, '.claude', 'muri-saver.json')).timezone, 'Asia/Tokyo');
});

test('--update without a previous install fails clearly', () => {
  const r = run('bin/install.mjs', ['--update'], { home: freshHome() });
  assert.equal(r.status, 1);
  assert.match(r.out, /precisa de uma instalação anterior/);
});

test('invalid --timezone is rejected', () => {
  const r = run('bin/install.mjs', ['--timezone', 'Mars/Olympus'], { home: freshHome() });
  assert.equal(r.status, 1);
});

test('pre-existing user file is backed up before being overwritten', () => {
  const home = freshHome();
  mkdirSync(join(home, '.claude', 'scripts'), { recursive: true });
  writeFileSync(join(home, '.claude', 'scripts', 'statusline.py'), '# versão minha\n');
  const r = run('bin/install.mjs', [], { home });
  assert.match(r.out, /backup .*statusline\.py/);
});

test('--uninstall removes installed files and hook entries, keeps edited ones', () => {
  const home = freshHome();
  const settingsPath = join(home, '.claude', 'settings.json');
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify({ model: 'sonnet', statusLine: { type: 'command', command: 'mine' } }));
  run('bin/install.mjs', [], { home });
  appendFileSync(join(home, '.claude', 'CLAUDE.md'), '\n# editado\n');
  const r = run('bin/install.mjs', ['--uninstall'], { home });
  assert.equal(r.status, 0, r.out);
  assert.equal(existsSync(join(home, '.agents', 'skills', 'muri-saver', 'SKILL.md')), false);
  assert.equal(existsSync(join(home, '.claude', 'hooks', 'obsidian-vault-check.mjs')), false);
  assert.equal(existsSync(join(home, '.claude', 'muri-saver.json')), false);
  assert.ok(existsSync(join(home, '.claude', 'CLAUDE.md')), 'edited CLAUDE.md must stay');
  assert.deepEqual(readJson(settingsPath), { model: 'sonnet', statusLine: { type: 'command', command: 'mine' } });
  assert.ok(existsSync(join(home, '.claude', 'muri-saver-backups')));
});

test('--dry-run writes nothing', () => {
  const home = tempDir();
  run('bin/install.mjs', ['--dry-run', '--with-all'], { home });
  assert.deepEqual(readdirSync(home), []);
});
