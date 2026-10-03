#!/usr/bin/env node
// Delega uma tarefa do agente principal (o "maestro", normalmente o Claude Code)
// para outro agente headless, gastando a cota DELE em vez da do maestro, e
// devolve só um resumo curto para o contexto de quem chamou.
//
//   gemini → `agy` (Antigravity, Gemini Flash): leitura, pesquisa, resumo, rascunho de doc
//   codex  → `codex exec` (sandbox real): revisão somente leitura, ou --write para implementar
//
// Uso:
//   node muri-delegate.mjs <gemini|codex> [opções] "<brief>"
//   echo "<brief>" | node muri-delegate.mjs <gemini|codex> [opções] -
// Opções:
//   --write          (só codex) sandbox workspace-write; exige `git status` limpo
//   --cd DIR         diretório de trabalho (padrão: o atual)
//   --model M        força o modelo (gemini: id do `agy models`; codex: id do -m)
//   --effort E       low|medium|high (padrão: medium)
//   --file F         anexa o conteúdo de F ao brief (repetível)
//   --lines N        máx. de linhas devolvidas (padrão: 60)
//   --timeout S      mata o delegado após S segundos (padrão: 900)
// Saída: cabeçalho + até N linhas; resposta completa num arquivo temporário.
// Exit: 0 ok · 2 uso/pré-condição · 3 o delegado alterou arquivos numa tarefa
//       somente leitura · 64 recursão · 75 cota esgotada (troque de delegado)

import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { RUNTIME_SCRIPTS_DIR, CHILD_ENV, bin, isMain, appendLog } from '../hooks/muri-common.mjs';

const RATE_RE = /rate.?limit|quota|429|usage limit|resource.?exhausted|too many requests/i;

function die(msg, code = 2) {
  process.stderr.write(`[muri-delegate] ${msg}\n`);
  process.exit(code);
}

export function parseArgs(argv) {
  const o = { agent: argv[0], write: false, dir: process.cwd(), model: '', effort: 'medium', files: [], lines: 60, timeout: 900, brief: '' };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') o.write = true;
    else if (a === '--cd') o.dir = argv[++i];
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--effort') o.effort = argv[++i];
    else if (a === '--file') o.files.push(argv[++i]);
    else if (a === '--lines') o.lines = Number(argv[++i]) || 60;
    else if (a === '--timeout') o.timeout = Number(argv[++i]) || 900;
    else if (a === '-') o.brief = readFileSync(0, 'utf8');
    else if (a.startsWith('--')) die(`opção desconhecida: ${a}`);
    else o.brief = o.brief ? `${o.brief} ${a}` : a;
  }
  return o;
}

function git(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? r.stdout : null;
}

export function buildPrompt(o) {
  const mode = o.write
    ? `Você PODE editar arquivos dentro de ${o.dir} para cumprir o brief. Não faça commit, push, nem instale dependências se o brief não pedir. Ao final, liste os arquivos alterados.`
    : 'SOMENTE LEITURA: não crie, edite, mova nem apague arquivos, e não rode comandos que alterem estado (git commit, npm install, migrations etc.).';
  let prompt = `[DELEGAÇÃO muri-saver] Você é um agente delegado por outro agente (o orquestrador). Regras:
1. Não delegue a outro agente nem crie subagentes.
2. ${mode}
3. Consulte o ai-memory só se o brief exigir histórico do projeto.
4. Responda em no máximo ${o.lines} linhas, direto, sem preâmbulo: resultado, arquivos relevantes (caminho:linha), riscos/dúvidas.

BRIEF:
${o.brief}`;
  for (const f of o.files) {
    if (!existsSync(f)) die(`arquivo não encontrado: ${f}`);
    prompt += `\n\n--- ARQUIVO: ${f} ---\n${readFileSync(f, 'utf8').slice(0, 200000)}`;
  }
  return prompt;
}

function main() {
  if (process.env.MURI_DELEGATE === '1') die('recusado: já estou dentro de uma delegação (MURI_DELEGATE=1)', 64);
  const o = parseArgs(process.argv.slice(2));
  if (!['gemini', 'codex'].includes(o.agent)) die(`agente inválido: '${o.agent || ''}' (use gemini|codex)`);
  if (!o.brief.trim() && !process.stdin.isTTY) o.brief = readFileSync(0, 'utf8');
  if (!o.brief.trim()) die('brief vazio');
  if (!existsSync(o.dir) || !statSync(o.dir).isDirectory()) die(`diretório não existe: ${o.dir}`);
  o.dir = resolve(o.dir);
  if (!['low', 'medium', 'high'].includes(o.effort)) die(`effort inválido: ${o.effort}`);
  if (o.agent === 'gemini' && o.write) die('escrita só via codex (o agy não tem sandbox de escrita no modo headless)');

  const isGit = git(o.dir, ['rev-parse', '--is-inside-work-tree']) !== null;
  if (o.write) {
    if (!isGit) die('--write exige um repositório git (pra revisar o diff depois)');
    if (git(o.dir, ['status', '--porcelain'])?.trim()) die("--write exige 'git status' limpo: commite ou guarde (stash) antes, pra o diff do delegado ficar isolado");
  }

  const prompt = buildPrompt(o);
  const outDir = join(os.tmpdir(), 'muri-delegate');
  mkdirSync(outDir, { recursive: true });
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  const out = join(outDir, `${stamp}-${o.agent}.md`);
  const full = join(outDir, `${stamp}-${o.agent}.log`);
  const before = isGit ? git(o.dir, ['status', '--porcelain']) : null;
  const env = { ...process.env, ...CHILD_ENV };
  const t0 = Date.now();
  let rc;
  let text = '';
  let model = o.model;

  if (o.agent === 'gemini') {
    const agy = bin('agy');
    if (!agy) die('agy (Antigravity CLI) não encontrado no PATH');
    model ||= `gemini-3.8-flash-${o.effort}`;
    const line = JSON.stringify({ event: 'user', message: { role: 'user', content: prompt } });
    const r = spawnSync(agy.cmd, [...agy.pre, '--input-format', 'stream-json', '--output-format', 'stream-json', '--model', model, '--print-timeout', `${o.timeout}s`], {
      cwd: o.dir, env, input: `${line}\n`, encoding: 'utf8', timeout: (o.timeout + 30) * 1000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    });
    writeFileSync(full, `${r.stdout || ''}\n${r.stderr || ''}`);
    let result = null;
    for (const l of String(r.stdout || '').split('\n')) {
      try { const ev = JSON.parse(l); if (ev.event === 'result') result = ev.result; } catch { /* parcial */ }
    }
    text = result?.status === 'SUCCESS' ? String(result.response || '') : '';
    rc = r.error?.code === 'ETIMEDOUT' || r.signal ? 142 : (text ? 0 : (r.status || 1));
  } else {
    const codex = bin('codex');
    if (!codex) die('codex (Codex CLI) não encontrado no PATH');
    const args = ['exec', '-C', o.dir, '-s', o.write ? 'workspace-write' : 'read-only', '-c', `model_reasoning_effort=${o.effort}`,
      '--ephemeral', '--skip-git-repo-check', '-o', out];
    if (o.model) args.push('-m', o.model);
    args.push('-');
    const r = spawnSync(codex.cmd, [...codex.pre, ...args], {
      env, input: prompt, encoding: 'utf8', timeout: o.timeout * 1000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    });
    writeFileSync(full, `${r.stdout || ''}\n${r.stderr || ''}`);
    text = existsSync(out) ? readFileSync(out, 'utf8') : '';
    rc = r.error?.code === 'ETIMEDOUT' || r.signal ? 142 : (r.status ?? 1);
    model ||= 'padrão-codex';
  }
  writeFileSync(out, text);
  const secs = Math.round((Date.now() - t0) / 1000);
  const mode = o.write ? 'write' : 'read';
  appendLog(join(RUNTIME_SCRIPTS_DIR, '.delegations.log'),
    `${new Date().toISOString()}\t${o.agent}\t${model}\t${o.effort}\t${mode}\t${secs}s\trc=${rc}\t${Buffer.byteLength(text)}B\t${o.dir}`);

  if (rc !== 0 || !text.trim()) {
    const log = readFileSync(full, 'utf8');
    if (RATE_RE.test(log)) die(`cota esgotada: ${o.agent}, troque de delegado (log: ${full})`, 75);
    if (rc === 142) process.stderr.write(`[muri-delegate] timeout após ${o.timeout}s: ${o.agent} (log: ${full})\n`);
    process.stderr.write(`[muri-delegate] falhou: ${o.agent} rc=${rc}; últimas linhas do log (${full}):\n${log.trim().split('\n').slice(-15).join('\n')}\n`);
    process.exit(rc || 1);
  }

  const lines = text.replace(/\s+$/, '').split('\n');
  console.log(`[muri-delegate] ${o.agent} (${model}, ${o.effort}, ${mode}) ${secs}s · resposta completa: ${out}`);
  console.log(lines.slice(0, o.lines).join('\n'));
  if (lines.length > o.lines) console.log(`[... truncado: ${lines.length} linhas no total; use grep em ${out} se precisar]`);

  if (isGit && !o.write) {
    const after = git(o.dir, ['status', '--porcelain']);
    if (before !== after) {
      process.stderr.write(`[muri-delegate] ALERTA: o delegado ALTEROU arquivos numa tarefa somente leitura:\n--- antes\n${before}--- depois\n${after}`);
      process.exit(3);
    }
  }
  if (o.write) console.log(`[muri-delegate] arquivos alterados (revise com git diff):\n${git(o.dir, ['status', '--porcelain']) || ''}`);
  return 0;
}

if (isMain(import.meta.url)) main();
