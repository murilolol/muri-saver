import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tempDir, cleanEnv, REPO_ROOT } from './_helpers.mjs';

const skip = process.platform === 'win32' && 'python3 fora do PATH no Windows';

// HOME temporário com ~/.claude/hooks; o guarda roda do repo e cai no ~/.claude desse HOME.
function setup({ settings, janela } = {}) {
  const home = tempDir();
  mkdirSync(join(home, '.claude', 'hooks'), { recursive: true });
  if (settings) writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(settings));
  if (janela) writeFileSync(join(home, '.claude', 'hooks', '.guarda-contexto-janela.json'), JSON.stringify({ s1: janela }));
  const transcript = join(home, 't.jsonl');
  const guard = () => {
    const r = spawnSync('python3', [join(REPO_ROOT, 'hooks', 'guarda-contexto.py')], {
      input: JSON.stringify({ prompt: 'oi', session_id: 's1', transcript_path: transcript }), encoding: 'utf8', env: cleanEnv(home),
    });
    return r.stdout ? JSON.parse(r.stdout) : null;
  };
  return { home, transcript, guard };
}

const at = (ageMin) => new Date(Date.now() - ageMin * 60000).toISOString();
const turn = (ctx, ageMin, cache = { ephemeral_1h_input_tokens: 500 }) =>
  JSON.stringify({ timestamp: at(ageMin), message: { usage: { input_tokens: ctx, cache_creation: cache } } }) + '\n';
const boundary = (post, ageMin) =>
  JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: at(ageMin), compactMetadata: { trigger: 'auto', preTokens: 230_000, postTokens: post } }) + '\n';
const ctxOf = (out) => out.hookSpecificOutput.additionalContext;

test('guarda: autoCompactWindow 250k segura 1x o cache frio e avisa em 70% e 90% do ponto (217k)', { skip }, () => {
  const { transcript, guard } = setup({ settings: { autoCompactWindow: 250_000 } });
  writeFileSync(transcript, turn(100_000, 120)); // 100k > 40% de 217k
  assert.equal(guard().continue, false);
  assert.equal(guard(), null); // reenvio em até 15 min passa
  writeFileSync(transcript, turn(160_000, 1));
  assert.match(ctxOf(guard()), /~160k de ~217k/);
  assert.equal(guard(), null); // cada marco avisa uma vez só
  writeFileSync(transcript, turn(200_000, 1));
  assert.match(ctxOf(guard()), /~200k de ~217k/);
});

test('guarda: janela de 1M sem autoCompactWindow compacta em ~967k; 300k parado não segura', { skip }, () => {
  const { transcript, guard } = setup({ janela: [1_000_000, 'claude-x'] });
  writeFileSync(transcript, turn(300_000, 120));
  assert.equal(guard(), null);
  writeFileSync(transcript, turn(700_000, 1));
  assert.match(ctxOf(guard()), /~700k de ~967k/);
});

test('guarda: janela de 200k (da status line) limita o ponto a 167k', { skip }, () => {
  const { transcript, guard } = setup({ settings: { autoCompactWindow: 500_000 }, janela: [200_000, 'claude-x'] });
  writeFileSync(transcript, turn(120_000, 1));
  assert.match(ctxOf(guard()), /~120k de ~167k/);
});

test('guarda: modelSettings do modelo (onde o /autocompact grava) vence o autoCompactWindow global', { skip }, () => {
  const settings = { autoCompactWindow: 500_000, modelSettings: { 'claude-x': { autoCompactWindow: 300_000 } } };
  const { transcript, guard } = setup({ settings, janela: [1_000_000, 'claude-x[1m]'] });
  writeFileSync(transcript, turn(200_000, 1));
  assert.match(ctxOf(guard()), /~200k de ~267k/);
});

test('guarda: com TTL de 5 min só avisa (systemMessage), sem segurar o prompt', { skip }, () => {
  const { transcript, guard } = setup({ settings: { autoCompactWindow: 250_000 } });
  writeFileSync(transcript, turn(150_000, 10, { ephemeral_5m_input_tokens: 800, ephemeral_1h_input_tokens: 0 }));
  const out = guard();
  assert.equal(out.continue, undefined);
  assert.match(out.systemMessage, /TTL de 5 min.*~150k/);
  const umaHora = setup({ settings: { autoCompactWindow: 250_000 } });
  writeFileSync(umaHora.transcript, turn(150_000, 10)); // o mesmo cenário com TTL de 1 h ainda não esfriou
  assert.equal(umaHora.guard(), null);
});

test('guarda: depois de um compact_boundary vale o postTokens, não o contexto de antes', { skip }, () => {
  const { transcript, guard } = setup({ settings: { autoCompactWindow: 250_000 } });
  writeFileSync(transcript, turn(210_000, 130) + boundary(30_000, 120));
  assert.equal(guard(), null); // sem o boundary, 210k parado 2 h seria bloqueado
});

function statusline(home, payload) {
  return spawnSync('python3', [join(REPO_ROOT, 'scripts', 'statusline.py')], {
    input: JSON.stringify({ session_id: 's1', cwd: home, transcript_path: join(home, 'nada.jsonl'), model: { id: 'claude-x', display_name: 'X' }, ...payload }),
    encoding: 'utf8', env: cleanEnv(home, { COLUMNS: '200' }),
  }).stdout;
}

test('status line: 1M mede o % contra o ponto (967k), esconde 5h null e grava a janela pro guarda', { skip }, () => {
  const { home } = setup();
  const out = statusline(home, {
    context_window: { context_window_size: 1_000_000, total_input_tokens: 700_000 },
    rate_limits: { five_hour: null, seven_day: { used_percentage: 10, resets_at: Math.floor(Date.now() / 1000) + 3600 } },
  });
  assert.match(out, /700k\/967k .* 72%/);
  assert.match(out, /trocou de assunto\? \/clear/);
  assert.doesNotMatch(out, /5h/);
  assert.match(out, /7d /);
  const cache = JSON.parse(readFileSync(join(home, '.claude', 'hooks', '.guarda-contexto-janela.json'), 'utf8'));
  assert.deepEqual(cache.s1, [1_000_000, 'claude-x']);
});

test('status line: 200k compacta em 167k e a dica diz o valor', { skip }, () => {
  const { home } = setup();
  const out = statusline(home, { context_window: { context_window_size: 200_000, total_input_tokens: 160_000 } });
  assert.match(out, /160k\/167k .* 96%/);
  assert.match(out, /\/clear agora \(compacta em 167k\)/);
});

test('status line: sem janela nem autoCompactWindow, a dica não inventa o ponto', { skip }, () => {
  const { home } = setup();
  const out = statusline(home, { context_window: { total_input_tokens: 900_000 } });
  assert.match(out, /\/clear agora/);
  assert.doesNotMatch(out, /compacta em/);
});

test('usage-status: fuso do muri-saver.json, % fracionário arredondado e plano sem janela de 5h', { skip }, () => {
  const home = tempDir();
  mkdirSync(join(home, '.claude'));
  writeFileSync(join(home, '.claude', 'muri-saver.json'), JSON.stringify({ timezone: 'UTC' }));
  const usage = (util) => {
    writeFileSync(join(home, '.claude.json'), JSON.stringify(util === undefined ? {} : { cachedUsageUtilization: { utilization: util } }));
    return spawnSync('python3', [join(REPO_ROOT, 'scripts', 'usage-status.py')], { encoding: 'utf8', env: cleanEnv(home) });
  };
  const r = usage({ five_hour: null, seven_day: { utilization: 42.6, resets_at: '2099-01-01T00:00:00+00:00' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\(UTC\)/);
  assert.match(r.stdout, /Janela de 5h : plano sem janela 5h/);
  assert.match(r.stdout, /Semanal \(7d\) :  43% usado/);
  const vazio = usage(undefined); // sem cachedUsageUtilization: antes dava KeyError
  assert.equal(vazio.status, 0, vazio.stderr);
  assert.equal(vazio.stdout.match(/sem dado disponivel/g).length, 2);
});
