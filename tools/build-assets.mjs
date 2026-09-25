#!/usr/bin/env node
// Regenerates examples/vault/ and the README screenshots in assets/ from the
// test fixtures (fake demo sessions — no personal data). Dev-only.
//
//   node tools/build-assets.mjs                 examples + terminal SVGs + screenshots
//   node tools/build-assets.mjs --with-llm      also enrich one example session via a real `claude -p` (Haiku)
//   node tools/build-assets.mjs --with-doctor   also render doctor output (needs a real local setup)
//
// Screenshots need Google Chrome/Chromium (headless). Missing Chrome = skipped.

import {
  mkdtempSync, cpSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, utimesSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ansiToSvg } from './ansi-to-svg.mjs';
import { renderNote } from './render-note.mjs';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS = join(REPO, 'assets');
const EXAMPLES = join(REPO, 'examples', 'vault');
const FIXTURE_HOME = join(REPO, 'test', 'fixtures', 'home');
const TZ = 'America/Sao_Paulo';
const args = new Set(process.argv.slice(2));

const tmp = (p = 'muri-assets-') => mkdtempSync(join(os.tmpdir(), p));

function run(cmd, cmdArgs, { env = {}, input, cwd } = {}) {
  const base = { ...process.env };
  for (const k of ['OBSIDIAN_VAULT', 'MURI_SAVER_CONFIG', 'MURI_SAVER_TZ', 'MURI_SAVER_NOW', 'MURI_SAVER']) delete base[k];
  const r = spawnSync(cmd, cmdArgs, { env: { ...base, ...env }, input, cwd, encoding: 'utf8', timeout: 180000 });
  return `${r.stdout || ''}${r.stderr || ''}`;
}

const node = (script, scriptArgs, opts) => run(process.execPath, [join(REPO, script), ...scriptArgs], opts);

function anonymize(text, pairs) {
  let out = text;
  for (const [from, to] of pairs) out = out.split(from).join(to);
  return out;
}

function log(msg) {
  console.log(`[build-assets] ${msg}`);
}

// ------------------------------------------------------------ examples/vault

function buildExamples() {
  const source = tmp();
  cpSync(FIXTURE_HOME, source, { recursive: true });
  const vault = join(tmp(), 'Obsidian Vault');
  mkdirSync(join(vault, 'projects', 'demo-app'), { recursive: true });
  writeFileSync(join(vault, 'projects', 'demo-app', 'README.md'), '# demo-app\n\nProjeto fictício usado nos fixtures de teste do muri-saver.\n');

  const hookTranscript = join(FIXTURE_HOME, '.claude', 'projects', '-home-dev-demo-app', '0f1e2d3c-1111-4aaa-8bbb-222222222222.jsonl');
  const hookOut = run(process.execPath, [join(REPO, 'hooks', 'obsidian-vault-check.mjs')], {
    input: JSON.stringify({ session_id: 'b7e4c2a1-9d3f-4e5a-8b6c-1d2e3f4a5b6c', transcript_path: hookTranscript, cwd: tmp() }),
    env: { OBSIDIAN_VAULT: vault, MURI_SAVER: '1', MURI_SAVER_NOW: '2026-09-20T16:30:00Z', MURI_SAVER_TZ: TZ },
  });
  log(`hook Stop: ${hookOut.trim() || 'ok'}`);

  const llm = args.has('--with-llm');
  const claudeBin = join(os.homedir(), '.local', 'bin', 'claude');
  const ingestOut = node('bin/ingest-sessions.mjs', [
    '--all', '--source-home', source, '--vault', vault, '--skip-ai-memory', '--timezone', TZ,
    ...(llm ? ['--enrich', '--enrich-limit', '1'] : []),
  ], { env: llm && existsSync(claudeBin) ? { MURI_SAVER_CLAUDE_BIN: claudeBin } : {} });
  node('bin/ingest-sessions.mjs', ['--file', join(REPO, 'test', 'fixtures', 'desktop', 'conversations.json'), '--source-home', source, '--vault', vault, '--skip-ai-memory', '--timezone', TZ]);

  rmSync(EXAMPLES, { recursive: true, force: true });
  mkdirSync(dirname(EXAMPLES), { recursive: true });
  cpSync(vault, EXAMPLES, { recursive: true });
  log(`examples/vault regenerado (${llm ? 'com' : 'sem'} enriquecimento via LLM)`);
  return anonymize(ingestOut, [[source, '~/backup-maquina-antiga'], [vault, '~/Documents/Obsidian Vault']]);
}

// ------------------------------------------------------------ terminal SVGs

function fakeRepo(name, branch) {
  const dir = join(tmp(), name);
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
  writeFileSync(join(dir, '.git', 'index'), '');
  const past = new Date(Date.now() - 3600_000);
  utimesSync(join(dir, '.git', 'HEAD'), past, past);
  return dir;
}

function statusline(payload, columns) {
  return run('python3', [join(REPO, 'scripts', 'statusline.py')], { input: JSON.stringify(payload), env: { COLUMNS: String(columns) } }).replace(/\n$/, '');
}

function buildStatuslineSvg() {
  const now = Math.floor(Date.now() / 1000);
  const normal = statusline({
    cwd: fakeRepo('muri-saver', 'main'), model: { display_name: 'Sonnet 5' },
    context_window: { total_input_tokens: 170000, context_window_size: 1000000, used_percentage: 17 },
    cost: { total_duration_ms: 106000 },
    rate_limits: { five_hour: { used_percentage: 9, resets_at: now + 3 * 3600 + 41 * 60 + 30 }, seven_day: { used_percentage: 0, resets_at: now + 167 * 3600 + 90 } },
  }, 230);
  const hot = statusline({
    cwd: fakeRepo('api-server', 'feat/login'), model: { display_name: 'Opus 5.5' },
    context_window: { total_input_tokens: 912000, context_window_size: 1000000, used_percentage: 91 },
    cost: { total_duration_ms: 8049000, total_lines_added: 412, total_lines_removed: 97 },
    rate_limits: { five_hour: { used_percentage: 96, resets_at: now + 12 * 60 + 30 }, seven_day: { used_percentage: 64, resets_at: now + 51 * 3600 + 20 * 60 + 30 } },
  }, 230);
  const narrow = statusline({
    cwd: fakeRepo('landing-page', 'main'), model: { display_name: 'Haiku 4.5' },
    context_window: { total_input_tokens: 42000, context_window_size: 200000, used_percentage: 21 },
    cost: { total_duration_ms: 540000 },
    rate_limits: { five_hour: { used_percentage: 33, resets_at: now + 2 * 3600 + 5 * 60 + 30 }, seven_day: { used_percentage: 12, resets_at: now + 98 * 3600 + 30 } },
  }, 100);
  const gray = (s) => `\x1b[90m${s}\x1b[0m`;
  const text = [
    gray('# sessão normal — contexto em 170k já dispara a dica de /compact'),
    normal,
    '',
    gray('# sessão pesada — cores mudam em 70% (amarelo) e 90% (vermelho)'),
    hot,
    '',
    gray('# terminal estreito (<120 colunas) — só números, sem barras'),
    narrow,
  ].join('\n');
  writeFileSync(join(ASSETS, 'terminal-statusline.svg'), ansiToSvg(text, { title: 'statusline.py', fontSize: 13 }));
  log('assets/terminal-statusline.svg');
}

function buildInstallSvg() {
  const home = tmp();
  mkdirSync(join(home, '.codex'));
  mkdirSync(join(home, '.gemini'));
  const out = node('bin/install.mjs', ['--alias', 'mendes-saver', '--author-name', 'Mendes', '--vault', join(home, 'Documents', 'Obsidian Vault'), '--timezone', TZ],
    { env: { HOME: home, USERPROFILE: home } });
  const text = `\x1b[32m$\x1b[0m node bin/install.mjs --alias mendes-saver --author-name Mendes --vault "~/Documents/Obsidian Vault" --timezone ${TZ}\n${anonymize(out, [[home, '~']])}`;
  writeFileSync(join(ASSETS, 'terminal-install.svg'), ansiToSvg(text, { title: 'bin/install.mjs', fontSize: 12 }));
  log('assets/terminal-install.svg');
  return home;
}

function buildIngestSvg(ingestOut) {
  const text = `\x1b[32m$\x1b[0m node bin/ingest-sessions.mjs --all --source-home ~/backup-maquina-antiga ${args.has('--with-llm') ? '--enrich --enrich-limit 1' : ''}\n${ingestOut}`;
  writeFileSync(join(ASSETS, 'terminal-ingest.svg'), ansiToSvg(text, { title: 'bin/ingest-sessions.mjs', fontSize: 12 }));
  log('assets/terminal-ingest.svg');
}

function buildDoctorSvg(installHome) {
  const cfg = join(installHome, '.claude', 'muri-saver.json');
  const out = node('bin/doctor.mjs', [], { env: { MURI_SAVER_CONFIG: cfg } });
  const text = `\x1b[32m$\x1b[0m node bin/doctor.mjs\n${anonymize(out, [[installHome, '~'], [os.homedir(), '~']])}`
    .replace(/  OK   /g, '  \x1b[32mOK\x1b[0m   ')
    .replace(/  AVISO/g, '  \x1b[33mAVISO\x1b[0m')
    .replace(/  FALHA/g, '  \x1b[31mFALHA\x1b[0m')
    .replace(/(=== .* ===)/g, '\x1b[36m$1\x1b[0m');
  writeFileSync(join(ASSETS, 'terminal-doctor.svg'), ansiToSvg(text, { title: 'bin/doctor.mjs', fontSize: 12 }));
  log('assets/terminal-doctor.svg');
}

// ------------------------------------------------------------ screenshots

function findChrome() {
  const candidates = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
    win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
  }[process.platform] || [];
  return candidates.find(existsSync) || null;
}

function screenshot(chrome, htmlPath, outPath, width, height, scale = 1) {
  run(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--force-device-scale-factor=${scale}`,
    `--window-size=${width},${height}`, `--screenshot=${outPath}`, pathToFileURL(htmlPath).href,
  ]);
  log(`${outPath.replace(`${REPO}/`, '')}${existsSync(outPath) ? '' : ' (FALHOU)'}`);
}

function buildScreenshots() {
  const chrome = findChrome();
  if (!chrome) return log('Chrome/Chromium não encontrado — screenshots pulados.');
  const dir = tmp();

  const svg = readFileSync(join(ASSETS, 'architecture-diagram.svg'), 'utf8');
  const archHtml = join(dir, 'arch.html');
  writeFileSync(archHtml, `<!doctype html><html><body style="margin:0;background:#f5f5f5">${svg.replace('<svg ', '<svg width="820" height="680" ')}</body></html>`);
  screenshot(chrome, archHtml, join(ASSETS, 'architecture-diagram.png'), 820, 680, 2);

  const sessionsDir = join(EXAMPLES, 'claude', 'sessions');
  const notes = readdirSync(sessionsDir).filter((f) => f.endsWith('.md'));
  const enriched = notes.find((f) => readFileSync(join(sessionsDir, f), 'utf8').includes('ingest-sessions-enriched')) || notes.find((f) => f.includes('0f1e2d3c'));
  const sessionHtml = join(dir, 'session.html');
  writeFileSync(sessionHtml, renderNote(readFileSync(join(sessionsDir, enriched), 'utf8'), { title: enriched }));
  screenshot(chrome, sessionHtml, join(ASSETS, 'vault-session.png'), 1280, 1500);

  const dailyName = 'Daily-2026-09-20.md';
  const dailyHtml = join(dir, 'daily.html');
  writeFileSync(dailyHtml, renderNote(readFileSync(join(EXAMPLES, 'dailies', dailyName), 'utf8'), { title: dailyName }));
  screenshot(chrome, dailyHtml, join(ASSETS, 'vault-daily.png'), 1280, 820);
}

const ingestOut = buildExamples();
buildStatuslineSvg();
const installHome = buildInstallSvg();
buildIngestSvg(ingestOut);
if (args.has('--with-doctor')) buildDoctorSvg(installHome);
if (!args.has('--skip-screenshots')) buildScreenshots();
