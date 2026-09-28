import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { run, tempDir, fixtureHome, FIXTURE_HOME, REPO_ROOT } from './_helpers.mjs';

const TRANSCRIPT = join(FIXTURE_HOME, '.claude', 'projects', '-home-dev-demo-app', '0f1e2d3c-1111-4aaa-8bbb-222222222222.jsonl');

test('Stop hook writes into the vault/timezone from muri-saver.json', () => {
  const home = tempDir();
  const vault = join(home, 'custom-vault');
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'muri-saver.json'), JSON.stringify({ vault, timezone: 'Asia/Tokyo' }));
  const payload = JSON.stringify({ session_id: '0f1e2d3c-1111-4aaa-8bbb-222222222222', transcript_path: TRANSCRIPT, cwd: home });
  const r = run('hooks/obsidian-vault-check.mjs', [], {
    home, input: payload, env: { MURI_SAVER: '1', MURI_SAVER_NOW: '2026-09-20T23:30:00Z' },
  });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(readdirSync(join(vault, 'claude', 'sessions')), ['Session-2026-09-21_08h30-Claude-0f1e2d3c.md']);
  const note = readFileSync(join(vault, 'claude', 'sessions', 'Session-2026-09-21_08h30-Claude-0f1e2d3c.md'), 'utf8');
  const daily = readFileSync(join(vault, 'dailies', 'Daily-2026-09-21.md'), 'utf8');
  assert.match(daily, /Sessão Claude 0f1e2d3c/);
  assert.doesNotMatch(note + daily, /FAKEKEYFAKEKEY/, 'secrets typed in prompts must be masked in the vault');
  assert.match(note, /REDACTED:ANTHROPIC_KEY/);
  assert.equal(existsSync(join(home, 'Documents', 'Obsidian Vault')), false, 'must not fall back to the default vault');
});

test('OBSIDIAN_VAULT env wins over the config for the Codex hook', () => {
  const home = tempDir();
  const vault = join(home, 'env-vault');
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'muri-saver.json'), JSON.stringify({ vault: join(home, 'cfg-vault'), timezone: 'UTC' }));
  const r = run('hooks/codex/obsidian-codex-session.mjs', [], {
    home, input: JSON.stringify({ session_id: 'abc-123', cwd: home }), env: { OBSIDIAN_VAULT: vault, MURI_SAVER_NOW: '2026-09-20T12:00:00Z' },
  });
  assert.equal(r.status, 0, r.out);
  assert.ok(existsSync(join(vault, 'codex', 'sessions', 'Session-2026-09-20_12h00-Codex-abc-123.md')));
  assert.equal(existsSync(join(home, 'cfg-vault')), false);
});

test('install without a vault keeps Obsidian disabled across hooks and ingestor', () => {
  const home = tempDir();
  assert.equal(run('bin/install.mjs', [], { home }).status, 0);
  const cfg = JSON.parse(readFileSync(join(home, '.claude', 'muri-saver.json'), 'utf8'));
  assert.equal(cfg.vault, null);
  const claude = run('hooks/obsidian-vault-check.mjs', [], { home, input: JSON.stringify({ session_id: 'abc-123', transcript_path: TRANSCRIPT, cwd: home }), env: { MURI_SAVER: '1' } });
  const codex = run('hooks/codex/obsidian-codex-session.mjs', [], { home, input: JSON.stringify({ session_id: 'abc-123', cwd: home }) });
  assert.equal(claude.status, 0, claude.out);
  assert.equal(codex.status, 0, codex.out);
  assert.equal(existsSync(join(home, 'Documents', 'Obsidian Vault')), false);
  const ingest = run('bin/ingest-sessions.mjs', ['--all', '--dry-run'], { home });
  assert.equal(ingest.status, 0, ingest.out);
  assert.doesNotMatch(ingest.out, /vault: \/|vault: [A-Z]:/);
});

test('doctor reports the saved config after an install', () => {
  const home = fixtureHome();
  run('bin/install.mjs', ['--alias', 'mendes-saver', '--timezone', 'UTC'], { home });
  const r = run('bin/doctor.mjs', [], { home });
  assert.match(r.out, /config encontrada/);
  assert.match(r.out, /alias — mendes-saver/);
  assert.match(r.out, /arquivos instalados íntegros/);
  assert.match(r.out, /Resumo: \d+ falha/);
});

test('doctor accepts an installation without Obsidian', () => {
  const home = fixtureHome();
  run('bin/install.mjs', [], { home });
  const r = run('bin/doctor.mjs', [], { home });
  assert.match(r.out, /Obsidian opcional não configurado/);
  assert.doesNotMatch(r.out, /pasta do vault não encontrada/);
});

test('Stop hooks report a blocked vault path without blocking the agent', () => {
  const home = tempDir();
  const blockedVault = join(home, 'blocked-vault');
  writeFileSync(blockedVault, 'not a directory');
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'muri-saver.json'), JSON.stringify({ vault: blockedVault }));
  for (const [script, payload] of [
    ['hooks/obsidian-vault-check.mjs', { session_id: 'abc-123', transcript_path: TRANSCRIPT, cwd: home }],
    ['hooks/codex/obsidian-codex-session.mjs', { session_id: 'abc-123', cwd: home }],
  ]) {
    const r = run(script, [], { home, input: JSON.stringify(payload), env: { MURI_SAVER: '1' } });
    assert.equal(r.status, 0, r.out);
    assert.match(r.stderr, /muri-saver: falha ao gravar no vault \(ENOTDIR\).*doctor/);
    assert.doesNotMatch(r.stderr, /\n\s+at /, 'diagnostic must not dump a stack trace');
  }
});

test('cli dispatches subcommands and reports its version', () => {
  const home = tempDir();
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(run('bin/cli.mjs', ['--version'], { home }).stdout.trim(), pkg.version);
  assert.match(run('bin/cli.mjs', ['ingest', '--help'], { home }).stdout, /--enrich/);
  assert.equal(run('bin/cli.mjs', ['nope'], { home }).status, 1);
});
