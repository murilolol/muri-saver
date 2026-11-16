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

test('installed skill references stay usable through aliasing, update and uninstall', () => {
  const home = freshHome();
  const r = run('bin/install.mjs', ['--alias', 'lucas'], { home });
  assert.equal(r.status, 0, r.out);
  const reference = join(home, '.agents', 'skills', 'lucas', 'references', 'memory.md');
  assert.ok(existsSync(reference), 'installed SKILL.md must have its referenced memory adapter');
  const content = readFileSync(reference, 'utf8');
  assert.equal(run('bin/install.mjs', ['--update'], { home }).status, 0);
  assert.equal(readFileSync(reference, 'utf8'), content);
  assert.equal(run('bin/install.mjs', ['--uninstall'], { home }).status, 0);
  assert.equal(existsSync(reference), false);
});

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
  for (const s of ['muri-saver', 'grill-me']) assert.ok(existsSync(join(home, '.claude', 'skills', s, 'SKILL.md')), `~/.claude/skills/${s}`);
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
  assert.equal(existsSync(join(home, '.claude', 'skills', 'muri-saver', 'SKILL.md')), false);
  assert.equal(existsSync(join(home, '.claude', 'hooks', 'obsidian-vault-check.mjs')), false);
  assert.equal(existsSync(join(home, '.claude', 'muri-saver.json')), false);
  assert.ok(existsSync(join(home, '.claude', 'CLAUDE.md')), 'edited CLAUDE.md must stay');
  assert.deepEqual(readJson(settingsPath), { model: 'sonnet', statusLine: { type: 'command', command: 'mine' } });
  assert.ok(existsSync(join(home, '.claude', 'muri-saver-backups')));
});

test('--dry-run writes nothing and names what would change in settings.json', () => {
  const home = tempDir();
  const r = run('bin/install.mjs', ['--dry-run', '--with-all'], { home });
  assert.deepEqual(readdirSync(home), []);
  assert.match(r.out, /settings\.json \(.*hooks\.UserPromptSubmit, hooks\.Notification, statusLine\)/);
});

test('a flag missing its value fails before doing anything (--vault --dry-run used to install for real)', () => {
  for (const argv of [['--vault', '--dry-run'], ['--dry-run', '--vault'], ['--alias', '-h']]) {
    const home = tempDir();
    const r = run('bin/install.mjs', argv, { home });
    assert.equal(r.status, 1, `${argv.join(' ')}: ${r.out}`);
    assert.match(r.out, /precisa de um valor/);
    assert.deepEqual(readdirSync(home), []);
  }
  assert.equal(existsSync(join(process.cwd(), '--dry-run')), false);
});

test('unknown flag: exit 1 on a real run, only a warning with --dry-run', () => {
  const home = tempDir();
  const real = run('bin/install.mjs', ['--tier', 'max'], { home });
  assert.equal(real.status, 1, real.out);
  assert.match(real.out, /flag\(s\) desconhecida\(s\): --tier, max/);
  assert.deepEqual(readdirSync(home), []);
  const dry = run('bin/install.mjs', ['--tier', '--dry-run'], { home });
  assert.equal(dry.status, 0, dry.out);
  assert.match(dry.out, /AVISO: flag\(s\) desconhecida\(s\): --tier/);
  assert.deepEqual(readdirSync(home), []);
});

test('reinstalling over older hook forms does not duplicate them', () => {
  const home = freshHome();
  const settingsPath = join(home, '.claude', 'settings.json');
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify({ hooks: {
    Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'node', args: [join(home, '.claude', 'hooks', 'obsidian-vault-check.mjs')], statusMessage: 'antiga' }] }],
    UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: `python3 ${join(home, '.claude', 'hooks', 'guarda-contexto.py')}`, timeout: 5 }] }],
  } }));
  assert.equal(run('bin/install.mjs', [], { home }).status, 0);
  const { hooks } = readJson(settingsPath);
  for (const event of ['Stop', 'UserPromptSubmit']) assert.equal(hooks[event].length, 1, event);
});

test('hooks and status line call the Python found on PATH (python where there is no python3)', { skip: process.platform === 'win32' }, () => {
  const home = freshHome();
  const bin = tempDir();
  writeFileSync(join(bin, 'python'), '#!/bin/sh\ntouch "$0.rodou"\n', { mode: 0o755 });
  assert.equal(run('bin/install.mjs', [], { home, env: { PATH: bin } }).status, 0);
  const settings = readJson(join(home, '.claude', 'settings.json'));
  assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].command, 'python');
  assert.match(settings.statusLine.command, /^python \S+statusline\.py$/);
  assert.equal(existsSync(join(bin, 'python.rodou')), false, 'only reads PATH: on macOS without CLT, running python3 opens the install dialog');
});

test('"hooks": null in settings.json does not break the install', () => {
  const home = freshHome();
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: null }));
  const dry = run('bin/install.mjs', ['--dry-run'], { home });
  assert.equal(dry.status, 0, dry.out);
  assert.match(dry.out, /settings\.json \(.*hooks\.Stop/);
  assert.equal(run('bin/install.mjs', [], { home }).status, 0);
  assert.ok(readJson(join(home, '.claude', 'settings.json')).hooks.Stop);
});

test('another grill-me in ~/.claude/skills is kept (and survives --uninstall)', () => {
  const home = freshHome();
  const theirs = join(home, '.claude', 'skills', 'grill-me', 'SKILL.md');
  mkdirSync(join(home, '.claude', 'skills', 'grill-me'), { recursive: true });
  writeFileSync(theirs, '---\nname: grill-me\ndescription: de terceiros\n---\n');
  const r = run('bin/install.mjs', [], { home });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /AVISO: .*grill-me.* não sobrescrevi/);
  assert.match(readFileSync(theirs, 'utf8'), /de terceiros/);
  assert.equal(readFileSync(join(home, '.agents', 'skills', 'grill-me', 'SKILL.md'), 'utf8'), readFileSync('skills/grill-me/SKILL.md', 'utf8'));
  assert.equal(run('bin/install.mjs', ['--uninstall'], { home }).status, 0);
  assert.match(readFileSync(theirs, 'utf8'), /de terceiros/);
});
