import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { run, tempDir, REPO_ROOT } from './_helpers.mjs';
import { JOBS, launchdPlist, systemdUnits, cronLine, taskXml } from '../scripts/muri-jobs.mjs';

const PROGRAM = ['/usr/bin/node', '/home/dev/.claude/scripts/ai-memory-reprocess-parked.mjs'];

test('every job maps to a script that ships with the repo', () => {
  for (const [name, j] of Object.entries(JOBS)) {
    assert.ok(existsSync(join(REPO_ROOT, 'scripts', j.script)), `${name} → ${j.script}`);
    assert.ok(j.desc && j.desc.length > 10, `${name} tem descrição`);
  }
});

test('launchd plist: hourly at minute 10, keepAlive service, weekly report', () => {
  const hourly = launchdPlist('reprocess-parked', PROGRAM, '/tmp/x.log');
  assert.match(hourly, /<key>StartCalendarInterval<\/key>\s*<dict>\s*<key>Minute<\/key>\s*<integer>10<\/integer>/);
  assert.match(hourly, /<string>com\.muri-saver\.reprocess-parked<\/string>/);
  assert.match(hourly, /<string>\/tmp\/x\.log<\/string>/);
  assert.match(launchdPlist('llm-shim', PROGRAM), /<key>KeepAlive<\/key>\s*<true\/>/);
  const weekly = launchdPlist('economy-report', PROGRAM);
  assert.match(weekly, /<key>Weekday<\/key>\s*<integer>1<\/integer>[\s\S]*<key>Hour<\/key>\s*<integer>9<\/integer>/);
  assert.match(weekly, /<key>RunAtLoad<\/key>\s*<false\/>/);
});

test('systemd units and cron fallback', () => {
  const { service, timer } = systemdUnits('reprocess-parked', PROGRAM, '/tmp/x.log');
  assert.match(service, /Type=oneshot/);
  assert.match(service, /ExecStart="\/usr\/bin\/node" "\/home\/dev\/\.claude\/scripts\/ai-memory-reprocess-parked\.mjs"/);
  assert.match(timer, /OnCalendar=\*-\*-\* \*:10:00/);
  assert.match(systemdUnits('finalize-idle', PROGRAM).timer, /OnUnitActiveSec=60min/);
  const shim = systemdUnits('llm-shim', PROGRAM);
  assert.equal(shim.timer, null);
  assert.match(shim.service, /Restart=always/);
  assert.match(cronLine('reprocess-parked', PROGRAM, '/tmp/x.log'), /^10 \* \* \* \* .*# muri-saver:reprocess-parked$/);
  assert.match(cronLine('vault-backfill', PROGRAM), /^0 \*\/2 \* \* \* /);
  assert.match(cronLine('economy-report', PROGRAM), /^0 9 \* \* 1 /);
});

test('Task Scheduler XML: hourly repetition, logon trigger with restart for the service', () => {
  const hourly = taskXml('reprocess-parked', ['C:\\node\\node.exe', 'C:\\Users\\dev\\.claude\\scripts\\x.mjs'], new Date('2026-10-03T12:00:00'));
  assert.match(hourly, /<CalendarTrigger>.*<Interval>PT1H<\/Interval>/);
  assert.match(hourly, /<Command>C:\\node\\node\.exe<\/Command>/);
  assert.match(hourly, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
  const shim = taskXml('llm-shim', PROGRAM);
  assert.match(shim, /<LogonTrigger>/);
  assert.match(shim, /<RestartOnFailure>/);
  assert.match(shim, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
});

test('install/disable/remove in dry mode write and move the right files per OS', () => {
  const home = tempDir();
  const mac = run('scripts/muri-jobs.mjs', ['install', 'reprocess-parked'], { home, env: { MURI_SAVER_PLATFORM: 'darwin' } });
  assert.equal(mac.status, 0, mac.out);
  const plist = join(home, 'Library', 'LaunchAgents', 'com.muri-saver.reprocess-parked.plist');
  assert.ok(existsSync(plist));
  run('scripts/muri-jobs.mjs', ['disable', 'reprocess-parked'], { home, env: { MURI_SAVER_PLATFORM: 'darwin' } });
  assert.equal(existsSync(plist), false);
  assert.ok(existsSync(`${plist}.disabled`), 'disable keeps a .disabled copy so it does not come back after a reboot');
  run('scripts/muri-jobs.mjs', ['remove', 'reprocess-parked'], { home, env: { MURI_SAVER_PLATFORM: 'darwin' } });
  assert.equal(existsSync(`${plist}.disabled`), false);

  const lin = run('scripts/muri-jobs.mjs', ['install', 'finalize-idle', 'llm-shim'], { home, env: { MURI_SAVER_PLATFORM: 'linux' } });
  assert.equal(lin.status, 0, lin.out);
  const units = readdirSync(join(home, '.config', 'systemd', 'user')).sort();
  assert.deepEqual(units, ['muri-saver-finalize-idle.service', 'muri-saver-finalize-idle.timer', 'muri-saver-llm-shim.service']);

  const win = run('scripts/muri-jobs.mjs', ['install', 'reprocess-parked'], { home, env: { MURI_SAVER_PLATFORM: 'win32' } });
  assert.equal(win.status, 0, win.out);
  assert.match(readFileSync(join(home, '.claude', 'hooks', '.jobs-dry', 'reprocess-parked.xml'), 'utf8'), /<Task version="1.2"/);
});

test('unknown job fails clearly', () => {
  const r = run('scripts/muri-jobs.mjs', ['install', 'nope'], { home: tempDir() });
  assert.equal(r.status, 1);
  assert.match(r.out, /job desconhecido: nope/);
});

test('list shows every job with its schedule', () => {
  const r = run('scripts/muri-jobs.mjs', ['list'], { home: tempDir() });
  for (const name of Object.keys(JOBS)) assert.match(r.stdout, new RegExp(`^${name}\\s`, 'm'));
});
