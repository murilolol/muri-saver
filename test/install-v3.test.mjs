import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { run, tempDir, writeFile } from './_helpers.mjs';
import { guardAiMemoryHooks, unguardAiMemoryHooks } from '../lib/hooks-merge.mjs';

const AGY_AIM_GROUP = {
  'ai-memory': {
    PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: '/bin/ai-memory hook --event pre-tool-use --agent antigravity-cli' }] }],
    Stop: [{ type: 'command', command: '/bin/ai-memory hook --event stop --agent antigravity-cli' }],
    PreInvocation: [{ type: 'command', command: 'test -x /bin/ai-memory && /bin/ai-memory hook --event session-start' }],
  },
};

test('aim-guard wraps simple ai-memory commands, skips shell syntax, and unwraps cleanly', () => {
  const guarded = guardAiMemoryHooks(AGY_AIM_GROUP, '/h/.claude/hooks/aim-guard.mjs');
  assert.equal(guarded['ai-memory'].Stop[0].command, 'node "/h/.claude/hooks/aim-guard.mjs" -- /bin/ai-memory hook --event stop --agent antigravity-cli');
  assert.match(guarded['ai-memory'].PreToolUse[0].hooks[0].command, /^node ".*aim-guard\.mjs" -- \/bin\/ai-memory/);
  assert.equal(guarded['ai-memory'].PreInvocation[0].command, AGY_AIM_GROUP['ai-memory'].PreInvocation[0].command, 'shell syntax is left alone');
  assert.deepEqual(guardAiMemoryHooks(guarded, '/h/.claude/hooks/aim-guard.mjs'), guarded, 'idempotent');
  assert.deepEqual(unguardAiMemoryHooks(guarded, '/h/.claude/hooks/aim-guard.mjs'), AGY_AIM_GROUP);
});

test('install v3: SessionEnd hook, Codex forwarder pointed at the real hooks dir, guarded Antigravity, jobs and preserved config', () => {
  const home = tempDir();
  writeFile(join(home, '.gemini', 'config', 'hooks.json'), JSON.stringify(AGY_AIM_GROUP));
  writeFile(join(home, '.claude', 'muri-saver.json'), JSON.stringify({ version: '2.1.0', alias: 'muri-saver', narrative: { intervalMinutes: 30 }, manifest: [] }));
  const r = run('bin/install.mjs', ['--with-all', '--with-jobs', '--narrative-chain', 'agy:gemini-3.1-pro-high,bogus', '--language', 'en'], {
    home, env: { MURI_SAVER_PLATFORM: 'linux' },
  });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /entrada\(s\) inválida\(s\) em --narrative-chain ignorada\(s\): bogus/);

  const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
  assert.ok(settings.hooks.SessionEnd.some((e) => e.hooks.some((h) => (h.args || []).some((a) => a.endsWith('obsidian-vault-check.mjs')))));

  const codexHook = readFileSync(join(home, '.codex', 'hooks', 'obsidian-codex-session.mjs'), 'utf8');
  assert.doesNotMatch(codexHook, /'__MURI_SAVER_HOOKS_DIR__'/);
  assert.ok(codexHook.includes(JSON.stringify(join(home, '.claude', 'hooks')).slice(1, -1)));
  assert.ok(JSON.parse(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')).hooks.SessionEnd);

  for (const f of ['muri-common.mjs', 'muri-llm.mjs', 'aim-guard.mjs']) assert.ok(existsSync(join(home, '.claude', 'hooks', f)), f);
  for (const f of ['muri-jobs.mjs', 'ai-memory-llm-shim.mjs', 'ai-memory-reprocess-parked.mjs', 'muri-delegate.mjs']) assert.ok(existsSync(join(home, '.claude', 'scripts', f)), f);

  const agy = JSON.parse(readFileSync(join(home, '.gemini', 'config', 'hooks.json'), 'utf8'));
  assert.match(agy['ai-memory'].Stop[0].command, /aim-guard\.mjs" -- \/bin\/ai-memory/);
  assert.ok(agy['obsidian-vault-check'].Stop);

  const cfg = JSON.parse(readFileSync(join(home, '.claude', 'muri-saver.json'), 'utf8'));
  assert.deepEqual(cfg.narrative, { intervalMinutes: 30 }, 'hand-edited keys survive');
  assert.deepEqual(cfg.llm.narrative, ['agy:gemini-3.1-pro-high']);
  assert.equal(cfg.language, 'en');
  assert.deepEqual(cfg.jobs, ['finalize-idle', 'reprocess-parked', 'quota-snapshot', 'economy-report']);
  const units = readdirSync(join(home, '.config', 'systemd', 'user'));
  assert.ok(units.includes('muri-saver-reprocess-parked.timer'));
  const service = readFileSync(join(home, '.config', 'systemd', 'user', 'muri-saver-reprocess-parked.service'), 'utf8');
  assert.ok(service.includes(join(home, '.claude', 'scripts', 'ai-memory-reprocess-parked.mjs')), 'jobs run the INSTALLED scripts');

  // --update sem flags mantém tudo; --no-jobs remove.
  assert.equal(run('bin/install.mjs', ['--update'], { home, env: { MURI_SAVER_PLATFORM: 'linux' } }).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(home, '.claude', 'muri-saver.json'), 'utf8')).jobs, cfg.jobs);
  run('bin/install.mjs', ['--update', '--no-jobs'], { home, env: { MURI_SAVER_PLATFORM: 'linux' } });
  assert.equal(existsSync(join(home, '.config', 'systemd', 'user', 'muri-saver-reprocess-parked.timer')), false);
});

test('uninstall unwraps the Antigravity ai-memory hooks and removes jobs', () => {
  const home = tempDir();
  writeFile(join(home, '.gemini', 'config', 'hooks.json'), JSON.stringify(AGY_AIM_GROUP));
  run('bin/install.mjs', ['--with-all', '--jobs', 'finalize-idle'], { home, env: { MURI_SAVER_PLATFORM: 'linux' } });
  const r = run('bin/install.mjs', ['--uninstall'], { home, env: { MURI_SAVER_PLATFORM: 'linux' } });
  assert.equal(r.status, 0, r.out);
  const agy = JSON.parse(readFileSync(join(home, '.gemini', 'config', 'hooks.json'), 'utf8'));
  assert.deepEqual(agy, AGY_AIM_GROUP, 'ai-memory hooks back to how the ai-memory installer wrote them');
  assert.equal(existsSync(join(home, '.config', 'systemd', 'user', 'muri-saver-finalize-idle.timer')), false);
  void writeFileSync;
});
