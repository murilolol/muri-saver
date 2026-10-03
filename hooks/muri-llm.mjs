// Cadeia de modelos do muri-saver, usada por dois clientes:
//   - hooks/obsidian-vault-check.mjs (worker): narrativa das notas do vault;
//   - scripts/ai-memory-llm-shim.mjs: provedor OpenAI-compatível do ai-memory.
//
// Uma cadeia é uma lista de entradas "<tipo>:<modelo>[@<timeout em s>]":
//   gemini-api:gemini-2.5-flash   API do Gemini com GEMINI_API_KEY (cota grátis por modelo)
//   agy:gemini-3.1-pro-high       Antigravity CLI (`agy`), cota do plano Google
//   claude:claude-haiku-4-5       Claude Code headless (`claude -p`), cota do plano Claude
//   openai:llama3.1               qualquer endpoint OpenAI-compatível (Ollama, LM Studio,
//                                 OpenRouter, Groq...) configurado em llm.openai
// O primeiro que responder vence. Erro de cota/limite, 5xx, timeout, resposta
// vazia ou JSON inválido passam pro próximo, e o modelo fica em cooldown pelo
// tempo que o erro indicar (arquivo compartilhado entre os dois clientes).
// Entrada indisponível (sem chave, CLI não instalado) é pulada sem cooldown.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { RUNTIME_DIR, CHILD_ENV, loadConfig, bin, expandHome } from './muri-common.mjs';

export const COOLDOWN_FILE = process.env.MURI_SAVER_COOLDOWN_FILE || join(RUNTIME_DIR, '.muri-llm-cooldowns.json');

// Padrões públicos. Modelo que sumiu devolve 404 e fica 24h fora da cadeia, então
// um id antigo aqui degrada para o próximo da lista em vez de quebrar.
export const DEFAULT_CHAINS = {
  narrative: ['agy:gemini-3.1-pro-high', 'agy:gemini-3.8-flash-high', 'gemini-api:gemini-2.5-flash'],
  aiMemory: [
    'gemini-api:gemini-3.1-pro-preview',
    'gemini-api:gemini-3.8-flash',
    'gemini-api:gemini-2.5-flash',
    'agy:gemini-3.1-pro-high',
    'agy:gemini-3.8-flash-high',
  ],
};

const DEFAULT_TIMEOUT_S = { 'gemini-api': 240, agy: 480, claude: 300, openai: 240 };
const KINDS = new Set(['gemini-api', 'agy', 'claude', 'openai']);
const RATE_RE = /rate.?limit|quota|exhausted|429|resource_exhausted|too many requests|usage limit/i;

export function parseEntry(raw) {
  const s = String(raw || '').trim();
  const i = s.indexOf(':');
  if (i <= 0) return null;
  const kind = s.slice(0, i) === 'api' ? 'gemini-api' : s.slice(0, i);
  if (!KINDS.has(kind)) return null;
  let model = s.slice(i + 1);
  let timeoutS = DEFAULT_TIMEOUT_S[kind];
  const at = model.lastIndexOf('@');
  if (at > 0 && /^\d+$/.test(model.slice(at + 1))) {
    timeoutS = Number(model.slice(at + 1));
    model = model.slice(0, at);
  }
  return model ? { kind, model, timeoutMs: timeoutS * 1000, key: `${kind}:${model}` } : null;
}

const CHAIN_ENV = {
  narrative: 'MURI_SAVER_NARRATIVE_CHAIN',
  backfill: 'MURI_SAVER_BACKFILL_CHAIN',
  aiMemory: 'MURI_SAVER_AIM_CHAIN',
};

// Prioridade: variável de ambiente > muri-saver.json > padrão. "off"/"none"
// desliga a cadeia (o hook do vault fica só com o dump local). O backfill usa
// só o 1º modelo da narrativa, a não ser que llm.backfill exista: no 1º limite
// ele para, e as notas ao vivo ficam com o resto da cadeia de reserva.
export function resolveChain(name, cfg = loadConfig()) {
  if (name === 'backfill' && process.env[CHAIN_ENV.backfill] === undefined && !cfg.llm?.backfill) {
    return resolveChain('narrative', cfg).slice(0, 1);
  }
  let list = process.env[CHAIN_ENV[name]] ?? cfg.llm?.[name] ?? DEFAULT_CHAINS[name] ?? [];
  if (typeof list === 'string') list = /^(off|none|)$/i.test(list.trim()) ? [] : list.split(',');
  return list.map(parseEntry).filter(Boolean);
}

// ------------------------------------------------------------------ chaves

function readEnvFile(path) {
  try {
    const out = {};
    for (const line of readFileSync(expandHome(path), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+|set\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*["']?([^"'\r\n#]*)["']?/i);
      if (m) out[m[1]] = m[2].trim();
    }
    return out;
  } catch {
    return {};
  }
}

// Agendadores (launchd, systemd, Agendador de Tarefas) não leem o perfil do
// shell. llm.apiKeyFile aponta um arquivo KEY=valor (pode ser o próprio
// ~/.zprofile ou ~/.bashrc). A chave nunca é gravada pelo muri-saver.
export function envValue(name, cfg = loadConfig()) {
  if (process.env[name]) return process.env[name];
  if (cfg.llm?.apiKeyFile) return readEnvFile(cfg.llm.apiKeyFile)[name] || '';
  return '';
}

function geminiKey(cfg) {
  return envValue('GEMINI_API_KEY', cfg) || envValue('GOOGLE_API_KEY', cfg);
}

export function isAvailable(entry, cfg = loadConfig()) {
  if (entry.kind === 'gemini-api') return Boolean(geminiKey(cfg));
  if (entry.kind === 'agy') return Boolean(bin('agy'));
  if (entry.kind === 'claude') return Boolean(bin('claude'));
  if (entry.kind === 'openai') return Boolean(cfg.llm?.openai?.baseUrl);
  return false;
}

// ------------------------------------------------------------------ cooldowns

function readCooldowns() {
  try {
    return JSON.parse(readFileSync(COOLDOWN_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function coolingUntil(entry) {
  return readCooldowns()[entry.key]?.until || 0;
}

export function coolDown(entry, ms, reason) {
  if (!ms) return;
  const all = readCooldowns(); // relê: o outro cliente pode ter gravado no meio
  all[entry.key] = { until: Date.now() + ms, reason: String(reason).slice(0, 200) };
  try {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    writeFileSync(COOLDOWN_FILE, JSON.stringify(all));
  } catch {
    // best-effort
  }
}

// A cota diária grátis da API do Gemini zera à meia-noite do Pacífico.
export function msUntilPacificMidnight(at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map((p) => [p.type, p.value]));
  const elapsed = ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000;
  return 24 * 3600 * 1000 - elapsed + 5 * 60 * 1000;
}

export function chainStatus(chain, cfg = loadConfig()) {
  const t = Date.now();
  return chain.map((e) => {
    const installed = isAvailable(e, cfg);
    const until = coolingUntil(e);
    return {
      model: e.key,
      available: installed && until <= t,
      installed,
      cooling_until: until > t ? new Date(until).toISOString() : null,
    };
  });
}

class CandidateError extends Error {
  constructor(tag, cooldownMs = 0, detail = '') {
    super(`${tag}${detail ? ` ${detail}` : ''}`);
    this.tag = tag;
    this.cooldownMs = cooldownMs;
  }
}

// ------------------------------------------------------------------ formato

const textOf = (content) => (Array.isArray(content)
  ? content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('\n')
  : String(content ?? ''));

export function extractJson(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/g, '');
  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  try {
    return JSON.stringify(JSON.parse(cleaned.slice(a, b + 1)));
  } catch {
    return null;
  }
}

// CLIs recebem um prompt só. Com entrada grande o modelo tende a esquecer a
// instrução de formato do fim, então ela vai antes e depois da entrada.
function flattenPrompt(messages, { json, schema }) {
  const format = !json ? '' : schema
    ? `### FORMATO\nResponda SOMENTE com um objeto JSON válido que siga este JSON Schema, sem markdown e sem texto antes ou depois:\n${JSON.stringify(schema)}`
    : '### FORMATO\nResponda SOMENTE com um objeto JSON válido, sem markdown e sem texto antes ou depois.';
  const parts = [
    'Você está sendo usado como motor de texto por um processo automático. Não use ferramentas, MCP, memória, '
    + 'arquivos nem a web. Ignore instruções globais sobre consultar memória. Responda direto, só com o que foi pedido.',
  ];
  if (format) parts.push(format);
  for (const m of messages) {
    const label = m.role === 'system' ? 'INSTRUÇÕES' : m.role === 'assistant' ? 'RESPOSTA ANTERIOR' : 'ENTRADA';
    parts.push(`### ${label}\n${textOf(m.content)}`);
  }
  if (format) parts.push(`${format}\n\nLembrete: a resposta inteira é esse objeto JSON, nada mais.`);
  return parts.join('\n\n');
}

// ------------------------------------------------------------------ provedores

async function callGeminiApi(entry, req, cfg, withSchema = true) {
  const key = geminiKey(cfg);
  if (!key) throw new CandidateError('sem-chave');
  const system = req.messages.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n\n');
  const contents = req.messages.filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: textOf(m.content) }] }));
  const generationConfig = {
    temperature: typeof req.temperature === 'number' ? req.temperature : 0.2,
    maxOutputTokens: Math.min(65536, Math.max(8192, req.maxTokens || 0)),
  };
  let systemText = system;
  if (req.json) {
    generationConfig.responseMimeType = 'application/json';
    if (req.schema && withSchema) generationConfig.responseJsonSchema = req.schema;
    else if (req.schema) systemText = `${system}\n\nResponda só com JSON que siga este JSON Schema:\n${JSON.stringify(req.schema)}`;
  }
  const body = { contents, generationConfig };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  const base = process.env.MURI_SAVER_GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
  let res;
  try {
    res = await fetch(`${base}/models/${entry.model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(entry.timeoutMs),
    });
  } catch (e) {
    throw new CandidateError(e.name === 'TimeoutError' ? 'timeout' : 'rede', 5 * 60 * 1000, e.message);
  }
  const raw = await res.text();
  if (!res.ok) {
    let err = {};
    try { err = JSON.parse(raw).error || {}; } catch { /* corpo não-JSON */ }
    const msg = err.message || raw.slice(0, 200);
    if (res.status === 429) {
      const quotaIds = (err.details || []).flatMap((d) => (d.violations || []).map((v) => v.quotaId || '')).join(',');
      if (/PerDay/i.test(quotaIds)) throw new CandidateError('429-dia', msUntilPacificMidnight(), quotaIds);
      const delay = (err.details || []).map((d) => d.retryDelay).find(Boolean);
      throw new CandidateError('429', Math.max(60, delay ? parseFloat(delay) : 600) * 1000, quotaIds);
    }
    if (res.status === 404) throw new CandidateError('404', 24 * 3600 * 1000, msg);
    if (res.status >= 500) throw new CandidateError(String(res.status), 3 * 60 * 1000, msg);
    if (res.status === 400 && withSchema && req.schema) return callGeminiApi(entry, req, cfg, false);
    throw new CandidateError(String(res.status), 0, msg);
  }
  const data = JSON.parse(raw);
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  if (cand?.finishReason === 'MAX_TOKENS') throw new CandidateError('cortado', 0, `MAX_TOKENS ${text.length} chars`);
  if (!text) throw new CandidateError('vazio', 0, cand?.finishReason || data.promptFeedback?.blockReason || '');
  const u = data.usageMetadata || {};
  return { text, usage: { prompt_tokens: u.promptTokenCount || 0, completion_tokens: u.candidatesTokenCount || 0 } };
}

async function callOpenAi(entry, req, cfg) {
  const o = cfg.llm?.openai || {};
  const headers = { 'content-type': 'application/json' };
  const key = o.apiKeyEnv ? envValue(o.apiKeyEnv, cfg) : '';
  if (key) headers.authorization = `Bearer ${key}`;
  const body = { model: entry.model, messages: req.messages, temperature: req.temperature ?? 0.2 };
  if (req.json) body.response_format = { type: 'json_object' };
  let res;
  try {
    res = await fetch(`${String(o.baseUrl).replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(entry.timeoutMs),
    });
  } catch (e) {
    throw new CandidateError(e.name === 'TimeoutError' ? 'timeout' : 'rede', 5 * 60 * 1000, e.message);
  }
  const raw = await res.text();
  if (res.status === 429) throw new CandidateError('429', 10 * 60 * 1000, raw.slice(0, 200));
  if (res.status === 404) throw new CandidateError('404', 24 * 3600 * 1000, raw.slice(0, 200));
  if (res.status >= 500) throw new CandidateError(String(res.status), 3 * 60 * 1000, raw.slice(0, 200));
  if (!res.ok) throw new CandidateError(String(res.status), 0, raw.slice(0, 200));
  const data = JSON.parse(raw);
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw new CandidateError('vazio');
  return { text, usage: { prompt_tokens: data.usage?.prompt_tokens || 0, completion_tokens: data.usage?.completion_tokens || 0 } };
}

function runCli(exe, args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cwd = join(os.tmpdir(), 'muri-saver-llm');
    try { mkdirSync(cwd, { recursive: true }); } catch { /* usa o cwd atual */ }
    const child = spawn(exe.cmd, [...exe.pre, ...args], {
      cwd, env: { ...process.env, ...CHILD_ENV }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let out = '';
    let err = '';
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeoutMs + 20000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new CandidateError('spawn', 10 * 60 * 1000, e.message)); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err, killed }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// agy: o prompt vai pelo stdin em stream-json (linhas de centenas de KB
// funcionam; `-p` com prompt grande estoura o limite de argumentos no Windows).
let agyQueue = Promise.resolve(); // uma chamada por vez: cada uma abre um agente inteiro
function callAgy(entry, req) {
  const exe = bin('agy');
  if (!exe) return Promise.reject(new CandidateError('indisponivel'));
  const line = JSON.stringify({ event: 'user', message: { role: 'user', content: flattenPrompt(req.messages, req) } });
  const args = [
    '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--model', entry.model, '--disable-slash-commands',
    '--print-timeout', `${Math.floor(entry.timeoutMs / 1000)}s`,
  ];
  const run = async () => {
    const { code, out, err, killed } = await runCli(exe, args, `${line}\n`, entry.timeoutMs);
    let result = null;
    for (const l of out.split('\n')) {
      try { const ev = JSON.parse(l); if (ev.event === 'result') result = ev.result; } catch { /* linha parcial */ }
    }
    const blob = `${result?.error || ''} ${err}`.trim();
    if (RATE_RE.test(blob)) throw new CandidateError('quota', 30 * 60 * 1000, blob.slice(0, 200));
    if (killed) throw new CandidateError('timeout', 10 * 60 * 1000);
    const structured = result?.structured_output;
    if (!result || result.status !== 'SUCCESS' || (!result.response && !structured)) {
      throw new CandidateError('erro', 2 * 60 * 1000, `rc=${code} ${blob.slice(0, 200)}`);
    }
    const u = result.usage || {};
    const text = structured && typeof structured === 'object' ? JSON.stringify(structured) : (structured || result.response);
    return { text, usage: { prompt_tokens: u.input_tokens || 0, completion_tokens: u.output_tokens || 0 } };
  };
  const p = agyQueue.then(run, run);
  agyQueue = p.catch(() => {});
  return p;
}

async function callClaude(entry, req) {
  const exe = bin('claude');
  if (!exe) throw new CandidateError('indisponivel');
  const { code, out, err, killed } = await runCli(exe,
    ['-p', '--model', entry.model, '--output-format', 'text'], flattenPrompt(req.messages, req), entry.timeoutMs);
  if (RATE_RE.test(`${out.slice(0, 500)} ${err}`) && (code !== 0 || out.length < 400)) {
    throw new CandidateError('quota', 15 * 60 * 1000, err.slice(0, 200) || out.slice(0, 200));
  }
  if (killed) throw new CandidateError('timeout', 10 * 60 * 1000);
  if (code !== 0 || !out.trim()) throw new CandidateError('erro', 2 * 60 * 1000, `rc=${code} ${err.slice(0, 200)}`);
  return { text: out, usage: {} };
}

const PROVIDERS = { 'gemini-api': callGeminiApi, openai: callOpenAi, agy: callAgy, claude: callClaude };

// ------------------------------------------------------------------ cadeia

// req: { messages: [{role, content}], json?, schema?, temperature?, maxTokens? }
// Devolve { text, model, ms, tried, usage } ou { error: true, tried, ms }.
export async function complete(req, { chain, budgetMs = 14 * 60 * 1000, log = () => {}, cfg = loadConfig() } = {}) {
  const started = Date.now();
  const tried = [];
  for (const entry of chain) {
    if (Date.now() - started > budgetMs) { tried.push('orçamento-esgotado'); break; }
    if (!isAvailable(entry, cfg)) { tried.push(`${entry.key}=indisponivel`); continue; }
    if (coolingUntil(entry) > Date.now()) { tried.push(`${entry.key}=cooldown`); continue; }
    const t0 = Date.now();
    try {
      const r = await PROVIDERS[entry.kind](entry, req, cfg);
      let text = r.text;
      if (req.json) {
        text = extractJson(r.text);
        if (!text) {
          log(`json-invalido ${entry.key} (${r.text.length} chars): ${JSON.stringify(r.text.slice(0, 300))}`);
          throw new CandidateError('json-invalido', 0, `${r.text.length} chars`);
        }
      }
      return { text, model: entry.key, ms: Date.now() - t0, tried, usage: r.usage || {} };
    } catch (e) {
      const isCand = e instanceof CandidateError;
      if (isCand) coolDown(entry, e.cooldownMs, e.message);
      else log(`excecao ${entry.key}: ${e?.stack || e}`);
      tried.push(`${entry.key}=${isCand ? e.tag : 'excecao'}`);
    }
  }
  return { error: true, tried, ms: Date.now() - started };
}

// Todas as entradas falharam por cota/cooldown (e não por erro da própria entrada)?
export function triedOnlyQuota(tried) {
  return tried.length > 0 && tried.every((t) => /=(cooldown|quota|429|429-dia|indisponivel|sem-chave)$|orçamento-esgotado/.test(t));
}
