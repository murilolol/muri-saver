#!/usr/bin/env node
// Jobs de fundo do muri-saver, registrados no agendador nativo de cada SO:
//   macOS   → LaunchAgent em ~/Library/LaunchAgents (launchctl)
//   Linux   → unidade systemd --user (.service + .timer); sem systemd, crontab
//   Windows → Agendador de Tarefas (schtasks, pasta \muri-saver\)
//
// Uso:
//   node muri-jobs.mjs list                      jobs disponíveis e o que fazem
//   node muri-jobs.mjs status                    o que está registrado e ativo
//   node muri-jobs.mjs install <job...>|--all    registra (ou re-registra) os jobs
//   node muri-jobs.mjs remove <job...>|--all     remove do agendador
//   node muri-jobs.mjs disable <job>             desativa sem apagar (usado pelos scripts
//                                                quando a fila deles zera)
//   node muri-jobs.mjs run <job>                 roda o job agora, em primeiro plano
//
// MURI_SAVER_SCHEDULER=dry grava os arquivos mas não chama launchctl/systemctl/
// schtasks/crontab (usado nos testes).

import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { RUNTIME_DIR as HOOKS_DIR, IS_WINDOWS, resolveBin, loadConfig, isMain } from '../hooks/muri-common.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const DRY = process.env.MURI_SAVER_SCHEDULER === 'dry';
const PLATFORM = process.env.MURI_SAVER_PLATFORM || process.platform; // testes geram os 3 formatos

// every: minutos entre execuções · at: minuto fixo de toda hora · weekly: dia/hora
// keepAlive: serviço que fica de pé (reinicia se cair)
// selfDisable: o script se desativa sozinho quando não tem mais o que fazer
export const JOBS = {
  'llm-shim': {
    script: 'ai-memory-llm-shim.mjs', keepAlive: true,
    desc: 'Shim OpenAI-compatível: o ai-memory consolida usando a cadeia de modelos do muri-saver',
  },
  'finalize-idle': {
    script: 'ai-memory-finalize-idle.mjs', every: 60,
    desc: 'Encerra no ai-memory sessões abertas e ociosas (agentes sem SessionEnd, como o Antigravity)',
  },
  'reprocess-parked': {
    script: 'ai-memory-reprocess-parked.mjs', at: 10, selfDisable: true,
    desc: 'Reprocessa sessões que o ai-memory estacionou quando a cota acabou; para quando a fila zera',
  },
  'vault-backfill': {
    script: 'vault-backfill.mjs', every: 120, selfDisable: true,
    desc: 'Gera narrativa para notas antigas do vault que ficaram só com o dump; para quando a fila zera',
  },
  'quota-snapshot': {
    script: 'muri-economy-report.py', args: ['--snapshot'], every: 60, python: true,
    desc: 'Guarda a cota atual do Claude num histórico (base do relatório de economia)',
  },
  'economy-report': {
    script: 'muri-economy-report.py', args: ['--save'], weekly: { weekday: 1, hour: 9, minute: 0 }, python: true,
    desc: 'Relatório semanal de economia (segunda 09:00) gravado no vault',
  },
};

const label = (job) => `com.muri-saver.${job}`;
const unitName = (job) => `muri-saver-${job}`;
const taskName = (job) => `\\muri-saver\\${job}`;
// Os jobs rodam os scripts INSTALADOS (o instalador passa scriptsDir/hooksDir);
// rodando este arquivo direto, valem as pastas ao lado dele.
const logFile = (job, hooksDir = HOOKS_DIR) => join(hooksDir, `.job-${job}.log`);

function run(cmd, args, opts = {}) {
  if (DRY) return { status: 0, stdout: '', stderr: '', dry: true };
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

function pythonBin() {
  for (const name of IS_WINDOWS ? ['python', 'py', 'python3'] : ['python3', 'python']) {
    const b = resolveBin(name, 'MURI_SAVER_PYTHON_BIN');
    if (b) return b.cmd;
  }
  return null;
}

export function programFor(job, scriptsDir = SCRIPTS_DIR) {
  const j = JOBS[job];
  const script = join(scriptsDir, j.script);
  const interp = j.python ? pythonBin() : process.execPath;
  if (!interp) return null;
  return [interp, script, ...(j.args || [])];
}

function jobPath() {
  const sep = IS_WINDOWS ? ';' : ':';
  const dirs = IS_WINDOWS ? [dirname(process.execPath)] : [
    dirname(process.execPath), join(os.homedir(), '.local', 'bin'), join(os.homedir(), '.cargo', 'bin'),
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
  ];
  return [...new Set([...dirs, ...(process.env.PATH || '').split(sep).filter(Boolean)])].join(sep);
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ------------------------------------------------------------------ macOS

export function launchdPlist(job, program, log = logFile(job)) {
  const j = JOBS[job];
  let schedule = '';
  if (j.keepAlive) schedule = '  <key>KeepAlive</key>\n  <true/>\n';
  else if (j.every) schedule = `  <key>StartInterval</key>\n  <integer>${j.every * 60}</integer>\n`;
  else if (j.at !== undefined) schedule = `  <key>StartCalendarInterval</key>\n  <dict>\n    <key>Minute</key>\n    <integer>${j.at}</integer>\n  </dict>\n`;
  else if (j.weekly) schedule = `  <key>StartCalendarInterval</key>\n  <dict>\n    <key>Weekday</key>\n    <integer>${j.weekly.weekday}</integer>\n    <key>Hour</key>\n    <integer>${j.weekly.hour}</integer>\n    <key>Minute</key>\n    <integer>${j.weekly.minute}</integer>\n  </dict>\n`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- muri-saver: ${xml(j.desc)} -->
  <key>Label</key>
  <string>${label(job)}</string>
  <key>ProgramArguments</key>
  <array>
${program.map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(jobPath())}</string>
  </dict>
${schedule}  <key>RunAtLoad</key>
  <${j.weekly ? 'false' : 'true'}/>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;
}

const plistPath = (job) => join(os.homedir(), 'Library', 'LaunchAgents', `${label(job)}.plist`);
const uid = () => (typeof process.getuid === 'function' ? process.getuid() : 0);

const macos = {
  install(job, program, log) {
    const p = plistPath(job);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, launchdPlist(job, program, log));
    try { if (existsSync(`${p}.disabled`)) unlinkSync(`${p}.disabled`); } catch { /* ok */ }
    run('launchctl', ['bootout', `gui/${uid()}/${label(job)}`]);
    const r = run('launchctl', ['bootstrap', `gui/${uid()}`, p]);
    return r.status === 0 ? null : (r.stderr.trim() || `launchctl saiu com ${r.status}`);
  },
  // Mexe no arquivo ANTES do bootout: o bootout mata o próprio job que chamou.
  disable(job) {
    const p = plistPath(job);
    if (existsSync(p)) renameSync(p, `${p}.disabled`);
    run('launchctl', ['bootout', `gui/${uid()}/${label(job)}`]);
  },
  remove(job) {
    const p = plistPath(job);
    for (const f of [p, `${p}.disabled`]) { try { if (existsSync(f)) unlinkSync(f); } catch { /* ok */ } }
    run('launchctl', ['bootout', `gui/${uid()}/${label(job)}`]);
  },
  status(job) {
    const p = plistPath(job);
    if (!existsSync(p)) return existsSync(`${p}.disabled`) ? 'desativado (fila concluída)' : 'não instalado';
    const r = run('launchctl', ['print', `gui/${uid()}/${label(job)}`]);
    if (r.dry) return 'instalado (dry)';
    if (r.status !== 0) return 'arquivo presente, não carregado';
    const state = (r.stdout.match(/^\s*state = (.+)$/m) || [])[1] || '?';
    const exit = (r.stdout.match(/last exit code = (.+)$/m) || [])[1];
    return `carregado (${state}${exit ? `, última saída ${exit}` : ''})`;
  },
};

// ------------------------------------------------------------------ Linux

const quoteSystemd = (a) => `"${String(a).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function systemdUnits(job, program, log = logFile(job)) {
  const j = JOBS[job];
  const service = `[Unit]
Description=muri-saver: ${j.desc}

[Service]
Type=${j.keepAlive ? 'simple' : 'oneshot'}
ExecStart=${program.map(quoteSystemd).join(' ')}
Environment=${quoteSystemd(`PATH=${jobPath()}`)}
StandardOutput=append:${log}
StandardError=append:${log}
${j.keepAlive ? 'Restart=always\nRestartSec=30\n\n[Install]\nWantedBy=default.target\n' : ''}`;
  if (j.keepAlive) return { service, timer: null };
  let when = '';
  if (j.every) when = `OnBootSec=2min\nOnUnitActiveSec=${j.every}min`;
  else if (j.at !== undefined) when = `OnCalendar=*-*-* *:${String(j.at).padStart(2, '0')}:00`;
  else if (j.weekly) {
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][j.weekly.weekday];
    when = `OnCalendar=${day} *-*-* ${String(j.weekly.hour).padStart(2, '0')}:${String(j.weekly.minute).padStart(2, '0')}:00`;
  }
  const timer = `[Unit]
Description=muri-saver: ${j.desc}

[Timer]
${when}
Persistent=true

[Install]
WantedBy=timers.target
`;
  return { service, timer };
}

export function cronLine(job, program, log = logFile(job)) {
  const j = JOBS[job];
  let spec;
  if (j.keepAlive) spec = '@reboot';
  else if (j.every && j.every < 60) spec = `*/${j.every} * * * *`;
  else if (j.every) spec = `0 ${j.every === 60 ? '*' : `*/${Math.round(j.every / 60)}`} * * *`;
  else if (j.at !== undefined) spec = `${j.at} * * * *`;
  else spec = `${j.weekly.minute} ${j.weekly.hour} * * ${j.weekly.weekday}`;
  const cmd = program.map((a) => `'${String(a).replace(/'/g, "'\\''")}'`).join(' ');
  return `${spec} PATH='${jobPath()}' ${cmd} >> '${log}' 2>&1 # muri-saver:${job}`;
}

const unitDir = () => join(process.env.XDG_CONFIG_HOME || join(os.homedir(), '.config'), 'systemd', 'user');
const hasSystemdUser = () => !DRY && run('systemctl', ['--user', 'show-environment']).status === 0;

function crontabEdit(job, line) {
  const cur = run('crontab', ['-l']);
  const kept = (cur.status === 0 ? cur.stdout : '').split('\n').filter((l) => l && !l.endsWith(`# muri-saver:${job}`));
  if (line) kept.push(line);
  const r = run('crontab', ['-'], { input: `${kept.join('\n')}\n` });
  return r.status === 0 ? null : (r.stderr.trim() || 'crontab falhou');
}

const linux = {
  install(job, program, log) {
    const { service, timer } = systemdUnits(job, program, log);
    if (DRY || hasSystemdUser()) {
      mkdirSync(unitDir(), { recursive: true });
      writeFileSync(join(unitDir(), `${unitName(job)}.service`), service);
      if (timer) writeFileSync(join(unitDir(), `${unitName(job)}.timer`), timer);
      run('systemctl', ['--user', 'daemon-reload']);
      const r = run('systemctl', ['--user', 'enable', '--now', `${unitName(job)}.${timer ? 'timer' : 'service'}`]);
      return r.status === 0 ? null : (r.stderr.trim() || 'systemctl falhou');
    }
    return crontabEdit(job, cronLine(job, program, log));
  },
  disable(job) {
    if (hasSystemdUser()) {
      const kind = JOBS[job].keepAlive ? 'service' : 'timer';
      run('systemctl', ['--user', 'disable', '--now', `${unitName(job)}.${kind}`]);
    } else {
      crontabEdit(job, null);
    }
  },
  remove(job) {
    linux.disable(job);
    for (const ext of ['service', 'timer']) {
      const f = join(unitDir(), `${unitName(job)}.${ext}`);
      try { if (existsSync(f)) unlinkSync(f); } catch { /* ok */ }
    }
    if (hasSystemdUser()) run('systemctl', ['--user', 'daemon-reload']);
    else crontabEdit(job, null);
  },
  status(job) {
    const kind = JOBS[job].keepAlive ? 'service' : 'timer';
    if (existsSync(join(unitDir(), `${unitName(job)}.${kind}`))) {
      if (DRY) return 'instalado (dry)';
      const r = run('systemctl', ['--user', 'is-enabled', `${unitName(job)}.${kind}`]);
      return `systemd: ${r.stdout.trim() || 'desconhecido'}`;
    }
    const cur = run('crontab', ['-l']);
    return cur.stdout.split('\n').some((l) => l.endsWith(`# muri-saver:${job}`)) ? 'crontab: ativo' : 'não instalado';
  },
};

// ------------------------------------------------------------------ Windows

export function taskXml(job, program, startAt = new Date()) {
  const j = JOBS[job];
  const start = new Date(startAt.getTime() + 2 * 60 * 1000);
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  let trigger;
  if (j.keepAlive) trigger = '<LogonTrigger><Enabled>true</Enabled></LogonTrigger>';
  else if (j.every) {
    trigger = `<TimeTrigger><StartBoundary>${iso(start)}</StartBoundary><Enabled>true</Enabled><Repetition><Interval>PT${j.every}M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition></TimeTrigger>`;
  } else if (j.at !== undefined) {
    const s = new Date(start);
    s.setMinutes(j.at, 0, 0);
    trigger = `<CalendarTrigger><StartBoundary>${iso(s)}</StartBoundary><Enabled>true</Enabled><Repetition><Interval>PT1H</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>`;
  } else {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const s = new Date(start);
    s.setHours(j.weekly.hour, j.weekly.minute, 0, 0);
    trigger = `<CalendarTrigger><StartBoundary>${iso(s)}</StartBoundary><Enabled>true</Enabled><ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek><${days[j.weekly.weekday]} /></DaysOfWeek></ScheduleByWeek></CalendarTrigger>`;
  }
  const [cmd, ...args] = program;
  const argStr = args.map((a) => (/[\s"]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : a)).join(' ');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>muri-saver: ${xml(j.desc)}</Description></RegistrationInfo>
  <Triggers>${trigger}</Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>${j.keepAlive ? 'PT0S' : 'PT2H'}</ExecutionTimeLimit>
${j.keepAlive ? '    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>\n' : ''}    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>${xml(cmd)}</Command><Arguments>${xml(argStr)}</Arguments></Exec></Actions>
</Task>
`;
}

const windows = {
  install(job, program) {
    const file = join(os.tmpdir(), `muri-saver-${job}.xml`);
    writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(taskXml(job, program), 'utf16le')]));
    if (DRY) {
      const keep = join(HOOKS_DIR, '.jobs-dry');
      mkdirSync(keep, { recursive: true });
      writeFileSync(join(keep, `${job}.xml`), taskXml(job, program));
    }
    const r = run('schtasks', ['/Create', '/TN', taskName(job), '/XML', file, '/F']);
    try { unlinkSync(file); } catch { /* ok */ }
    if (r.status !== 0) return r.stderr.trim() || 'schtasks falhou';
    if (JOBS[job].keepAlive) run('schtasks', ['/Run', '/TN', taskName(job)]);
    return null;
  },
  disable(job) { run('schtasks', ['/Change', '/TN', taskName(job), '/DISABLE']); },
  remove(job) { run('schtasks', ['/Delete', '/TN', taskName(job), '/F']); },
  status(job) {
    const r = run('schtasks', ['/Query', '/TN', taskName(job), '/FO', 'LIST']);
    if (r.dry) return existsSync(join(HOOKS_DIR, '.jobs-dry', `${job}.xml`)) ? 'instalado (dry)' : 'não instalado';
    if (r.status !== 0) return 'não instalado';
    return `tarefa: ${((r.stdout.match(/^(?:Status|Estado):\s*(.+)$/mi) || [])[1] || '?').trim()}`;
  },
};

const backend = () => (PLATFORM === 'darwin' ? macos : PLATFORM === 'win32' ? windows : linux);

// ------------------------------------------------------------------ API

export function installJob(job, { scriptsDir = SCRIPTS_DIR, hooksDir = HOOKS_DIR } = {}) {
  if (!JOBS[job]) return `job desconhecido: ${job}`;
  const program = programFor(job, scriptsDir);
  if (!program) return 'python não encontrado (este job é um script Python)';
  try {
    return backend().install(job, program, logFile(job, hooksDir));
  } catch (e) {
    return e.message;
  }
}

export function removeJob(job) {
  try { backend().remove(job); } catch { /* best-effort */ }
}

export function disableJob(job) {
  try { backend().disable(job); } catch { /* best-effort */ }
}

export function jobStatus(job) {
  try { return backend().status(job); } catch (e) { return `erro: ${e.message}`; }
}

export function configuredJobs(cfg = loadConfig()) {
  return Array.isArray(cfg.jobs) ? cfg.jobs.filter((j) => JOBS[j]) : [];
}

// ------------------------------------------------------------------ CLI

function cli(argv) {
  const [cmd, ...rest] = argv;
  const names = rest.includes('--all') ? Object.keys(JOBS) : rest.filter((a) => !a.startsWith('-'));
  if (cmd === 'list' || !cmd) {
    for (const [name, j] of Object.entries(JOBS)) {
      const when = j.keepAlive ? 'serviço' : j.every ? `a cada ${j.every} min` : j.at !== undefined ? `toda hora, minuto ${j.at}` : 'semanal';
      console.log(`${name.padEnd(17)} ${when.padEnd(20)} ${j.desc}`);
    }
    return 0;
  }
  if (cmd === 'status') {
    for (const name of names.length ? names : Object.keys(JOBS)) console.log(`${name.padEnd(17)} ${jobStatus(name)}`);
    return 0;
  }
  if (cmd === 'install' || cmd === 'remove' || cmd === 'disable') {
    if (!names.length) { console.error(`uso: muri-jobs.mjs ${cmd} <job...>|--all`); return 2; }
    let failed = 0;
    for (const name of names) {
      if (!JOBS[name]) { console.error(`job desconhecido: ${name}`); failed++; continue; }
      if (cmd === 'install') {
        const err = installJob(name);
        console.log(`${name}: ${err ? `FALHOU — ${err}` : 'registrado'}`);
        if (err) failed++;
      } else {
        (cmd === 'remove' ? removeJob : disableJob)(name);
        console.log(`${name}: ${cmd === 'remove' ? 'removido' : 'desativado'}`);
      }
    }
    return failed ? 1 : 0;
  }
  if (cmd === 'run') {
    const program = JOBS[rest[0]] && programFor(rest[0]);
    if (!program) { console.error('uso: muri-jobs.mjs run <job>'); return 2; }
    return spawnSync(program[0], program.slice(1), { stdio: 'inherit' }).status ?? 1;
  }
  console.error('uso: muri-jobs.mjs list|status|install|remove|disable|run');
  return 2;
}

if (isMain(import.meta.url)) process.exitCode = cli(process.argv.slice(2));
