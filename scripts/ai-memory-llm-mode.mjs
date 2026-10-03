#!/usr/bin/env node
// Troca o provedor de LLM que o ai-memory usa para consolidar sessões em
// páginas da wiki (auto-improve, consolidation, memory_explore, lint com LLM).
// Mesmo script no macOS, Linux e Windows.
//
//   node ai-memory-llm-mode.mjs chain       shim local do muri-saver: cadeia de modelos com troca
//                                           automática em limite/erro (padrão recomendado)
//   node ai-memory-llm-mode.mjs gemini      Gemini 2.5 Flash direto pela API key (sem shim)
//   node ai-memory-llm-mode.mjs anthropic   Claude via ANTHROPIC_OAUTH_TOKEN (CONSOME a cota do
//                                           plano Claude Code)
//   node ai-memory-llm-mode.mjs off         sem LLM: o ai-memory só captura, não consolida
//   node ai-memory-llm-mode.mjs status      provedor ativo + modelos da cadeia
//   node ai-memory-llm-mode.mjs tune [--dry-run]
//                                           aplica os limites recomendados (entrada maior, mais
//                                           propostas por sessão, scheduler sem rajada)
//
// Grava llm_provider/llm_model/llm_base_url no config.toml do ai-memory (com
// backup ao lado) e reinicia o servidor local. Variáveis AI_MEMORY_LLM_* no
// ambiente do servidor têm prioridade sobre o config.toml.

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  HOOKS_DIR, CLAUDE_DIR, IS_WINDOWS, AI_MEMORY_PORT, aiMemoryPaths, shimPort, tcpUp, resolveBin, isMain,
} from '../hooks/muri-common.mjs';
import { envValue } from '../hooks/muri-llm.mjs';

const MODES = {
  chain: { provider: 'openai-compat', model: 'muri-chain', baseUrl: true, note: 'cadeia do muri-saver via shim local' },
  gemini: { provider: 'gemini', model: 'gemini-2.5-flash', keyVar: 'GEMINI_API_KEY', note: 'Gemini 2.5 Flash direto (sem shim)' },
  anthropic: { provider: 'anthropic-oauth', model: 'claude-sonnet-5-5', keyVar: 'ANTHROPIC_OAUTH_TOKEN', note: 'Claude via OAuth, consome a cota do plano Claude Code' },
  off: { provider: null, note: 'sem LLM' },
};

// Limites que mais decidem quanto de cada sessão vira memória (mais que o modelo).
export const TUNE = {
  '': { llm_timeout_secs: '900' },
  consolidation: { max_input_tokens: '300000', max_output_tokens: '64000' },
  auto_improve: {
    max_input_tokens: '150000', max_proposals_per_run: '12', min_confidence: '0.6',
    min_observations: '5', min_session_duration_secs: '60',
  },
  'auto_improve.scheduler': { interval_secs: '300', max_sessions_per_tick: '2' },
};

// Edita uma chave dentro de uma seção do TOML (ou no topo, seção ''), trocando
// também uma linha comentada "# chave = ..." do config padrão. Sem dependência.
export function setTomlKey(text, section, key, value) {
  const lines = text.split('\n');
  let start = 0;
  let end = lines.length;
  if (section) {
    start = lines.findIndex((l) => l.trim() === `[${section}]`);
    if (start === -1) return `${text.trimEnd()}\n\n[${section}]\n${key} = ${value}\n`;
    start += 1;
  }
  for (let i = start; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) { end = i; break; }
  }
  const re = new RegExp(`^\\s*#?\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
  const live = lines.slice(start, end).findIndex((l) => re.test(l) && !/^\s*#/.test(l));
  const idx = live !== -1 ? live : lines.slice(start, end).findIndex((l) => re.test(l));
  const line = value === null ? null : `${key} = ${value}`;
  if (idx !== -1) {
    if (line === null) lines[start + idx] = `# ${lines[start + idx].replace(/^\s*#?\s*/, '')}`;
    else lines[start + idx] = line;
  } else if (line !== null) {
    lines.splice(section ? start : end, 0, line);
  }
  return lines.join('\n');
}

function configToml() {
  return join(aiMemoryPaths().dataDir, 'config.toml');
}

function listenerPids(port) {
  if (IS_WINDOWS) {
    const r = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
    return (r.stdout || '').split('\n').filter((l) => l.includes(`:${port} `) && /LISTEN/i.test(l))
      .map((l) => l.trim().split(/\s+/).pop()).filter((p) => /^\d+$/.test(p));
  }
  const lsof = resolveBin('lsof');
  if (!lsof) return [];
  const r = spawnSync(lsof.cmd, ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  return (r.stdout || '').split('\n').filter((p) => /^\d+$/.test(p.trim())).map((p) => p.trim());
}

async function restartServer() {
  for (const pid of listenerPids(AI_MEMORY_PORT)) {
    if (IS_WINDOWS) spawnSync('taskkill', ['/PID', pid, '/F'], { windowsHide: true });
    else try { process.kill(Number(pid), 'SIGTERM'); } catch { /* já saiu */ }
  }
  for (let i = 0; i < 15 && (await tcpUp(AI_MEMORY_PORT)); i++) await new Promise((r) => setTimeout(r, 1000));
  spawnSync(process.execPath, [join(HOOKS_DIR, 'ai-memory-ensure-server.mjs')], { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 15 && !(await tcpUp(AI_MEMORY_PORT)); i++) await new Promise((r) => setTimeout(r, 1000));
  return tcpUp(AI_MEMORY_PORT);
}

async function shimHealth() {
  try {
    const res = await fetch(`http://127.0.0.1:${shimPort()}/health`, { signal: AbortSignal.timeout(3000) });
    return await res.json();
  } catch {
    return null;
  }
}

async function status() {
  const path = configToml();
  if (!existsSync(path)) { console.log(`config.toml do ai-memory não encontrado em ${path}`); return 1; }
  const text = readFileSync(path, 'utf8');
  for (const k of ['llm_provider', 'llm_model', 'llm_base_url', 'llm_timeout_secs']) {
    const m = text.match(new RegExp(`^${k}\\s*=\\s*(.+)$`, 'm'));
    console.log(`${k.padEnd(17)} ${m ? m[1] : '(não definido)'}`);
  }
  for (const v of ['AI_MEMORY_LLM_PROVIDER', 'AI_MEMORY_LLM_MODEL', 'AI_MEMORY_LLM_BASE_URL']) {
    if (process.env[v]) console.log(`AVISO: ${v}=${process.env[v]} está no ambiente e tem prioridade sobre o config.toml`);
  }
  const h = await shimHealth();
  if (!h) console.log(`shim: fora do ar em 127.0.0.1:${shimPort()}`);
  else for (const c of h.chain) console.log(`  ${c.model.padEnd(36)} ${c.available ? 'livre' : c.installed === false ? 'indisponível (sem chave/CLI)' : `cooldown até ${c.cooling_until}`}`);
  return 0;
}

function writeWithBackup(path, text, label) {
  copyFileSync(path, `${path}.bak-${label}`);
  writeFileSync(path, text);
}

async function setMode(name) {
  const mode = MODES[name];
  const path = configToml();
  if (!existsSync(path)) {
    console.error(`config.toml do ai-memory não encontrado em ${path}. Rode \`ai-memory init\` (ou inicie o servidor uma vez) antes.`);
    return 1;
  }
  if (mode.keyVar && !envValue(mode.keyVar)) {
    console.error(`ERRO: ${mode.keyVar} não está no ambiente nem no llm.apiKeyFile do muri-saver.json. O servidor herda o ambiente de quem o inicia.`);
    return 1;
  }
  let text = readFileSync(path, 'utf8');
  text = setTomlKey(text, '', 'llm_provider', mode.provider ? `"${mode.provider}"` : null);
  text = setTomlKey(text, '', 'llm_model', mode.model ? `"${mode.model}"` : null);
  text = setTomlKey(text, '', 'llm_base_url', mode.baseUrl ? `"http://127.0.0.1:${shimPort()}/v1"` : null);
  if (name === 'chain') text = setTomlKey(text, '', 'llm_timeout_secs', '900');
  writeWithBackup(path, text, 'llm-mode');
  console.log(`Modo ${name}: ${mode.note}. Gravado em ${path} (backup em ${path}.bak-llm-mode).`);

  // O hook SessionStart sobe o shim quando llm.shim = true.
  const cfgPath = process.env.MURI_SAVER_CONFIG || join(CLAUDE_DIR, 'muri-saver.json');
  if (existsSync(cfgPath)) {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    cfg.llm = { ...(cfg.llm || {}), shim: name === 'chain' };
    writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  }
  if (name === 'chain' && !(await shimHealth())) {
    spawnSync(process.execPath, [join(HOOKS_DIR, 'ai-memory-ensure-server.mjs')], { stdio: 'ignore', windowsHide: true });
    console.log('Shim iniciado. Para mantê-lo de pé sem depender de abrir um agente: `muri-saver jobs install llm-shim`.');
  }
  console.log((await restartServer()) ? 'Servidor ai-memory reiniciado.' : 'AVISO: o servidor ai-memory não voltou; rode `ai-memory serve` ou abra uma sessão do agente.');
  return status();
}

function tune(dry) {
  const path = configToml();
  if (!existsSync(path)) { console.error(`config.toml não encontrado em ${path}`); return 1; }
  let text = readFileSync(path, 'utf8');
  for (const [section, kv] of Object.entries(TUNE)) {
    for (const [k, v] of Object.entries(kv)) {
      text = setTomlKey(text, section, k, v);
      console.log(`${section ? `[${section}] ` : ''}${k} = ${v}`);
    }
  }
  if (dry) { console.log('--dry-run: nada gravado.'); return 0; }
  writeWithBackup(path, text, 'tune');
  console.log(`Gravado em ${path} (backup em ${path}.bak-tune). Reinicie o servidor do ai-memory para valer.`);
  return 0;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'status' || !cmd) return status();
  if (cmd === 'tune') return tune(rest.includes('--dry-run'));
  const alias = { cadeia: 'chain', economico: 'gemini', premium: 'anthropic' }[cmd] || cmd;
  if (MODES[alias]) return setMode(alias);
  console.error('Uso: ai-memory-llm-mode.mjs chain|gemini|anthropic|off|status|tune [--dry-run]');
  return 2;
}

if (isMain(import.meta.url)) process.exitCode = await main();
