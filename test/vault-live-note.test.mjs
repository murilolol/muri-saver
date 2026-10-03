import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, tempDir, writeFile, FIXTURE_HOME, REPO_ROOT } from './_helpers.mjs';

const SID = '0f1e2d3c-1111-4aaa-8bbb-222222222222';
const TRANSCRIPT = join(FIXTURE_HOME, '.claude', 'projects', '-home-dev-demo-app', `${SID}.jsonl`);
const FAKE_AGY = join(REPO_ROOT, 'tools', 'test-bin', 'fake-agy.mjs');

function setup() {
  const home = tempDir();
  const vault = join(home, 'vault');
  writeFile(join(vault, 'projects', 'demo-app', 'README.md'), '# demo-app\n');
  writeFile(join(home, '.claude', 'muri-saver.json'), JSON.stringify({ vault, timezone: 'UTC' }));
  return { home, vault };
}

function stop(home, payload, env = {}) {
  return run('hooks/obsidian-vault-check.mjs', [], {
    home, input: JSON.stringify(payload), env: { MURI_SAVER_NOW: '2026-09-20T13:10:00Z', ...env },
  });
}

// O worker recebe o payload por arquivo, como no spawn real.
function worker(home, payload, env = {}) {
  const inputPath = writeFile(join(home, `worker-${Date.now()}.json`), JSON.stringify(payload));
  return run('hooks/obsidian-vault-check.mjs', [inputPath], {
    home,
    env: {
      MURI_SAVER_NOW: '2026-09-20T13:20:00Z', MURI_VAULT_WORKER: '1',
      MURI_SAVER_NARRATIVE_CHAIN: 'agy:fake-model', MURI_SAVER_AGY_BIN: FAKE_AGY, ...env,
    },
  });
}

test('Stop writes the dump note and the Daily entry without calling any model', () => {
  const { home, vault } = setup();
  const r = stop(home, { session_id: SID, transcript_path: TRANSCRIPT, cwd: home });
  assert.equal(r.status, 0, r.out);
  const [note] = readdirSync(join(vault, 'claude', 'sessions'));
  const text = readFileSync(join(vault, 'claude', 'sessions', note), 'utf8');
  assert.match(text, /formato: v2/);
  assert.match(text, /<!-- auto-narrativa:start -->\n_Narrativa pendente/);
  assert.match(text, /<!-- auto-dump:start -->[\s\S]*Login\.tsx[\s\S]*<!-- auto-dump:end -->/);
  assert.match(text, /REDACTED:ANTHROPIC_KEY/);
  assert.doesNotMatch(text, /FAKEKEYFAKEKEY/);
  assert.match(readFileSync(join(vault, 'dailies', 'Daily-2026-09-20.md'), 'utf8'), /Sessão Claude 0f1e2d3c/);
});

test('worker fills the narrative block, keeps manual notes and never sends secrets to the model', () => {
  const { home, vault } = setup();
  stop(home, { session_id: SID, transcript_path: TRANSCRIPT, cwd: home });
  const notePath = join(vault, 'claude', 'sessions', readdirSync(join(vault, 'claude', 'sessions'))[0]);
  appendFileSync(notePath, '\n## Minhas anotações\n\nnão apagar isto\n');
  const promptOut = join(home, 'prompt.txt');
  const r = worker(home, { session_id: SID, transcript_path: TRANSCRIPT, cwd: home, vault_session_path: notePath }, { FAKE_AGY_PROMPT_OUT: promptOut });
  assert.equal(r.status, 0, r.out);

  const text = readFileSync(notePath, 'utf8');
  assert.match(text, /## 🧠 Narrativa — Botão de login corrigido no mobile/);
  assert.match(text, /^narrativa: agy:fake-model$/m);
  assert.match(text, /title: "Sessão Claude 0f1e2d3c — Botão de login corrigido no mobile"/);
  assert.match(text, /<!-- auto-dump:start -->/, 'dump block stays');
  assert.match(text, /não apagar isto/, 'text outside the generated blocks is never touched');
  assert.doesNotMatch(readFileSync(promptOut, 'utf8'), /FAKEKEYFAKEKEY/, 'secrets are masked before reaching the model');

  assert.match(readFileSync(join(vault, 'dailies', 'Daily-2026-09-20.md'), 'utf8'), /↳ \*\*Narrativa:\*\* .*largura fixa/);
  const decisions = readdirSync(join(vault, 'projects', 'demo-app', 'decisoes'));
  assert.equal(decisions.length, 1);
  assert.ok(existsSync(notePath.replace(/\.md$/, '.canvas')));
  assert.match(readFileSync(join(home, '.claude', 'hooks', '.vault-llm.log'), 'utf8'), /\tok\tagy:fake-model\t/);

  // Regenerar não duplica a taxonomia nem o bloco.
  worker(home, { session_id: SID, transcript_path: TRANSCRIPT, cwd: home, vault_session_path: notePath, hook_event_name: 'SessionEnd' });
  assert.equal(readdirSync(join(vault, 'projects', 'demo-app', 'decisoes')).length, 1);
  assert.equal(readFileSync(notePath, 'utf8').split('<!-- auto-narrativa:start -->').length, 2);
});

test('quota on every model leaves the dump, cools the model down and makes backfill exit 75', () => {
  const { home, vault } = setup();
  stop(home, { session_id: SID, transcript_path: TRANSCRIPT, cwd: home });
  const notePath = join(vault, 'claude', 'sessions', readdirSync(join(vault, 'claude', 'sessions'))[0]);
  const cooldowns = join(home, 'cooldowns.json');
  const r = worker(home, { session_id: SID, transcript_path: TRANSCRIPT, cwd: home, vault_session_path: notePath },
    { FAKE_AGY_MODE: 'quota', MURI_SAVER_COOLDOWN_FILE: cooldowns });
  assert.equal(r.status, 0, r.out);
  assert.match(readFileSync(notePath, 'utf8'), /_Narrativa pendente/);
  assert.ok(JSON.parse(readFileSync(cooldowns, 'utf8'))['agy:fake-model'].until > Date.now());

  const b = worker(home, { session_id: SID, transcript_path: TRANSCRIPT, cwd: home, vault_session_path: notePath, hook_event_name: 'SessionEnd' },
    { MURI_VAULT_BACKFILL: '1', MURI_SAVER_COOLDOWN_FILE: cooldowns });
  assert.equal(b.status, 75, 'backfill stops at the first limit');
});

test('the skill name inside injected instructions no longer tags the session (only what the user typed)', () => {
  const { home, vault } = setup();
  const transcript = writeFile(join(home, 't.jsonl'), [
    { type: 'user', timestamp: '2026-09-20T13:00:00Z', message: { content: '<system-reminder>skills: muri-saver, grill-me</system-reminder>arruma o teste' } },
    { type: 'assistant', timestamp: '2026-09-20T13:01:00Z', message: { content: [{ type: 'text', text: 'feito' }] } },
  ].map((o) => JSON.stringify(o)).join('\n'));
  stop(home, { session_id: 'aaaabbbb-0000-4000-8000-000000000001', transcript_path: transcript, cwd: home });
  const note = readFileSync(join(vault, 'claude', 'sessions', readdirSync(join(vault, 'claude', 'sessions'))[0]), 'utf8');
  assert.doesNotMatch(note, /- muri-saver/);

  const typed = writeFile(join(home, 't2.jsonl'), JSON.stringify({ type: 'user', timestamp: '2026-09-20T13:00:00Z', message: { content: 'muri saver: revisa isso' } }));
  stop(home, { session_id: 'ccccdddd-0000-4000-8000-000000000002', transcript_path: typed, cwd: home });
  const notes = readdirSync(join(vault, 'claude', 'sessions')).map((n) => readFileSync(join(vault, 'claude', 'sessions', n), 'utf8'));
  assert.ok(notes.some((n) => /- muri-saver/.test(n)));
});

test('Codex hook forwards to the same pipeline and normalizes the rollout', () => {
  const { home, vault } = setup();
  const id = '7c7c7c7c-3333-4ccc-8ddd-444444444444';
  const dir = join(home, '.codex', 'sessions', '2026', '09', '20');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `rollout-2026-09-20T12-00-00-${id}.jsonl`), [
    { type: 'response_item', timestamp: '2026-09-20T12:00:00Z', payload: { type: 'message', role: 'user', content: [{ text: '# AGENTS.md instructions for /x' }] } },
    { type: 'response_item', timestamp: '2026-09-20T12:00:05Z', payload: { type: 'message', role: 'user', content: [{ text: 'adiciona paginação na listagem' }] } },
    { type: 'response_item', timestamp: '2026-09-20T12:01:00Z', payload: { type: 'message', role: 'assistant', content: [{ text: 'Paginação adicionada.' }] } },
  ].map((o) => JSON.stringify(o)).join('\n'));
  const r = run('hooks/codex/obsidian-codex-session.mjs', [], { home, input: JSON.stringify({ session_id: id, cwd: home }), env: { MURI_SAVER_NOW: '2026-09-20T12:05:00Z' } });
  assert.equal(r.status, 0, r.out);
  const [note] = readdirSync(join(vault, 'codex', 'sessions'));
  assert.match(note, /^Session-2026-09-20_12h05-Codex-/);
  const text = readFileSync(join(vault, 'codex', 'sessions', note), 'utf8');
  assert.match(text, /adiciona paginação na listagem/);
  assert.doesNotMatch(text, /AGENTS\.md instructions/);
});

test('headless runs of muri-saver itself never create notes', () => {
  const { home, vault } = setup();
  const r = stop(home, { session_id: SID, transcript_path: TRANSCRIPT, cwd: home }, { MURI_DELEGATE: '1' });
  assert.equal(r.status, 0);
  assert.equal(existsSync(join(vault, 'claude', 'sessions')), false);
});
