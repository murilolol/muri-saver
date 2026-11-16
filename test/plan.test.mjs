import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, run, tempDir, writeFile } from './_helpers.mjs';
import { PLAN_PROFILES, planFromName, detectPlan } from '../lib/plan.mjs';

// Um `claude` falso: `auth status` imprime `json`, `--text` imprime `text`; sem saída, sai com 1.
// `code` força o código de saída: o CLI real deslogado imprime o JSON e sai com 1.
function fakeClaude(dir, { json, text, code }) {
  return writeFile(join(dir, 'fake-claude.mjs'), `
const isText = process.argv.includes('--text');
const out = isText ? ${JSON.stringify(text ?? null)} : ${JSON.stringify(json ? JSON.stringify(json) : null)};
if (out !== null) console.log(out);
process.exitCode = ${code ?? 'null'} ?? (out === null ? 1 : 0);
`);
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

test('profiles: every plan has a window except auto, and names map to profiles (20x is Ultra)', () => {
  for (const id of ['pro', 'max', 'ultra', 'team', 'enterprise', 'api']) assert.ok(PLAN_PROFILES.perfis[id].autoCompactWindow >= 100000, id);
  assert.equal(PLAN_PROFILES.perfis.auto.autoCompactWindow, null);
  assert.equal(PLAN_PROFILES.perfis.pro.palpite, false, 'só o Pro tem base medida');
  assert.equal(planFromName('max_20x'), 'ultra');
  assert.equal(planFromName('default_claude_max_20x'), 'ultra');
  assert.equal(planFromName('max_5x'), 'max');
  assert.equal(planFromName('Max'), 'max');
  assert.equal(planFromName('Ultra'), 'ultra');
  assert.equal(planFromName('pro'), 'pro');
  assert.equal(planFromName('enterprise'), 'enterprise');
  assert.equal(planFromName(undefined), null);
});

test('plan-profiles.json keeps the same marks and margin as guarda-contexto.py', () => {
  const py = readFileSync(join(REPO_ROOT, 'hooks', 'guarda-contexto.py'), 'utf8');
  assert.equal(Number(py.match(/^FOLGA = ([\d_]+)/m)[1].replaceAll('_', '')), PLAN_PROFILES.folga);
  assert.deepEqual(py.match(/^MARCOS_FRAC = \(([^)]*)\)/m)[1].split(',').map(Number), PLAN_PROFILES.marcos);
});

test('detectPlan cascades auth status JSON → --text → ~/.claude.json → auto', () => {
  const home = tempDir();
  const missing = join(home, 'no-claude');
  const det = (fake) => detectPlan({ claudeBin: fake, home });
  const ultra = { json: { authMethod: 'claude.ai', subscriptionType: 'max', planTier: 'max_20x' } };

  assert.deepEqual(det(fakeClaude(home, ultra)), { plan: 'auto', source: null }, 'no ~/.claude.json: claude never ran here');
  // Conta antiga no ~/.claude.json: só vale quando o CLI não responde.
  writeFile(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { planDisplayName: 'Pro' } }));
  assert.deepEqual(det(fakeClaude(home, ultra)), { plan: 'ultra', source: 'claude auth status' });
  assert.equal(det(fakeClaude(home, { json: { authMethod: 'api_key' } })).plan, 'api');
  assert.deepEqual(det(fakeClaude(home, { json: { loggedIn: false, authMethod: 'none' }, text: 'Not logged in.', code: 1 })),
    { plan: 'auto', source: null }, 'logged out (exit 1): no guessing from older data');
  assert.deepEqual(det(fakeClaude(home, { text: 'Login method: Claude Max account' })), { plan: 'max', source: 'claude auth status --text' });
  assert.deepEqual(det(missing), { plan: 'pro', source: '~/.claude.json' });

  writeFile(join(home, '.claude.json'), '{}');
  assert.deepEqual(det(missing), { plan: 'auto', source: null });
  writeFile(join(home, '.claude.json'), '{not json');
  assert.deepEqual(det(missing), { plan: 'auto', source: null }, 'invalid ~/.claude.json does not throw');
  writeFile(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { organizationRateLimitTier: 'default_claude_max_20x' } }));
  assert.deepEqual(det(missing), { plan: 'ultra', source: '~/.claude.json' });
  writeFile(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { planDisplayName: 'Max', organizationRateLimitTier: 'default_claude_max_20x' } }));
  assert.equal(det(missing).plan, 'max', 'planDisplayName comes first');
});

test('install --plan: invalid value exits 1 and writes nothing', () => {
  const home = tempDir();
  for (const args of [['--plan', 'gold'], ['--plan'], ['--plan', '--dry-run'], ['--plan', '__proto__'], ['--plan', 'constructor']]) {
    const r = run('bin/install.mjs', args, { home });
    assert.equal(r.status, 1, `${args.join(' ')}\n${r.out}`);
  }
  assert.equal(existsSync(join(home, '.claude')), false);
});

test('install --dry-run does not run claude in a HOME where it never ran (it would create ~/.claude.json)', () => {
  const home = tempDir();
  // Igual ao CLI real: rodar o claude cria a config dele no HOME.
  const fake = writeFile(join(tempDir(), 'fake-claude.mjs'), `
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
writeFileSync(join(process.env.HOME, '.claude.json'), '{}');
console.log(JSON.stringify({ authMethod: 'claude.ai', planTier: 'max_20x' }));
`);
  const r = run('bin/install.mjs', ['--dry-run'], { home, env: { MURI_SAVER_CLAUDE_BIN: fake } });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Plano: auto \(não detectado\)/);
  assert.equal(existsSync(join(home, '.claude.json')), false);
});

test('install saves the plan (detected, flag or kept) and --apply-compact writes only when the value is ours', () => {
  const home = tempDir();
  const cfgPath = join(home, '.claude', 'muri-saver.json');
  const settingsPath = join(home, '.claude', 'settings.json');
  const fake = fakeClaude(home, { json: { authMethod: 'claude.ai', planTier: 'max_20x' } });
  writeFile(join(home, '.claude.json'), '{}');

  let r = run('bin/install.mjs', [], { home });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Plano: auto \(não detectado\)/);
  assert.equal(readJson(cfgPath).plan, undefined, 'auto sem detecção não fica salvo');
  r = run('bin/install.mjs', ['--update'], { home, env: { MURI_SAVER_CLAUDE_BIN: fake } });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Plano: ultra \(detectado por claude auth status\)/, 'o --update seguinte detecta de novo');
  assert.equal(readJson(cfgPath).plan, 'ultra');
  assert.equal(readJson(settingsPath).autoCompactWindow, undefined, 'sem --apply-compact o settings não ganha autoCompactWindow');

  const doctor = run('bin/doctor.mjs', [], { home, env: { MURI_SAVER_CLAUDE_BIN: fake } });
  assert.match(doctor.out, /plano do Claude — perfil ultra: autoCompactWindow 500k \(palpite\), avisos em ~327k e ~420k · detectado: ultra/);

  r = run('bin/install.mjs', ['--update', '--plan', 'ULTRA', '--apply-compact'], { home });
  assert.equal(r.status, 0, r.out);
  assert.equal(readJson(settingsPath).autoCompactWindow, 500000);
  assert.equal(readJson(cfgPath).autoCompactInstalled, 500000);

  r = run('bin/install.mjs', ['--update', '--plan', 'pro', '--apply-compact'], { home });
  assert.equal(readJson(settingsPath).autoCompactWindow, 250000, 'o valor gravado pelo muri-saver acompanha o perfil');
  assert.equal(readJson(cfgPath).plan, 'pro');
  assert.match(run('bin/doctor.mjs', [], { home, env: { MURI_SAVER_CLAUDE_BIN: fake } }).out,
    /AVISO plano do Claude — perfil pro: .* · detectado: ultra .* --update --plan ultra/, 'salvo diverge do detectado');
  assert.equal(run('bin/install.mjs', ['--update'], { home }).status, 0);
  assert.equal(readJson(cfgPath).plan, 'pro', '--update sem --plan mantém o salvo');

  run('bin/install.mjs', ['--update', '--plan', 'ultra'], { home });
  assert.match(run('bin/doctor.mjs', [], { home }).out, /AVISO plano do Claude — perfil ultra: .* settings\.json ainda tem 250k; .* --apply-compact/,
    '--plan sem --apply-compact deixa o valor do perfil anterior');

  const settings = readJson(settingsPath);
  writeFile(settingsPath, JSON.stringify({ ...settings, autoCompactWindow: 300000 }));
  r = run('bin/install.mjs', ['--update', '--plan', 'ultra', '--apply-compact'], { home });
  assert.match(r.out, /você já tem um valor \(autoCompactWindow 300000\) — mantido/);
  assert.equal(readJson(settingsPath).autoCompactWindow, 300000);

  writeFile(settingsPath, JSON.stringify({ ...settings, autoCompactWindow: undefined, modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 600000 } } }));
  r = run('bin/install.mjs', ['--update', '--apply-compact'], { home });
  assert.match(r.out, /você já tem um valor \(modelSettings\)/);
  assert.equal(readJson(settingsPath).autoCompactWindow, undefined);
});

test('uninstall removes autoCompactWindow only while it is still the installed value', () => {
  const home = tempDir();
  const settingsPath = join(home, '.claude', 'settings.json');
  assert.equal(run('bin/install.mjs', ['--plan', 'max', '--apply-compact'], { home }).status, 0);
  assert.equal(readJson(settingsPath).autoCompactWindow, 400000);
  assert.equal(run('bin/install.mjs', ['--uninstall'], { home }).status, 0);
  assert.equal(readJson(settingsPath).autoCompactWindow, undefined);

  const home2 = tempDir();
  const settings2 = join(home2, '.claude', 'settings.json');
  run('bin/install.mjs', ['--plan', 'max', '--apply-compact'], { home: home2 });
  writeFile(settings2, JSON.stringify({ ...readJson(settings2), autoCompactWindow: 350000 }));
  run('bin/install.mjs', ['--uninstall'], { home: home2 });
  assert.equal(readJson(settings2).autoCompactWindow, 350000, 'valor editado por você fica');
});
