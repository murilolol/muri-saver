#!/usr/bin/env node
// Shim OpenAI-compatível entre o ai-memory e a cadeia de modelos do muri-saver.
//
// O ai-memory fala com ele pelo provedor `openai-compat` (llm_base_url no
// config.toml, ver scripts/ai-memory-llm-mode.mjs) e o shim percorre a cadeia
// `llm.aiMemory` do muri-saver.json (padrão: modelos da API do Gemini e depois o
// `agy`, cota do plano Google). Troca de modelo sozinho em 429, 5xx, 404,
// timeout, resposta vazia ou JSON inválido/cortado, e põe o modelo em cooldown
// pelo tempo que o erro indicar.
//
// Por que existe: o ai-memory não tem provedor por CLI (agy/claude) e a cadeia
// de fallback nativa dele não trata JSON cortado nem cota diária por modelo.
//
// Sobe por `muri-saver jobs install llm-shim` (serviço) ou pelo hook
// SessionStart (ai-memory-ensure-server.mjs) quando llm.shim = true.
// Status: GET http://127.0.0.1:49380/health   Log: ~/.claude/hooks/.ai-memory-llm-shim.log

import http from 'node:http';
import { join } from 'node:path';
import { RUNTIME_DIR, loadConfig, shimPort, appendLog } from '../hooks/muri-common.mjs';
import { complete, resolveChain, chainStatus } from '../hooks/muri-llm.mjs';

const CFG = loadConfig();
const PORT = shimPort(CFG);
const LOG = join(RUNTIME_DIR, '.ai-memory-llm-shim.log');
const TOTAL_BUDGET_MS = 14 * 60 * 1000; // abaixo do llm_timeout_secs = 900 recomendado no ai-memory
const MAX_BODY_BYTES = 16 * 1024 * 1024;

function log(line) {
  appendLog(LOG, `${new Date().toISOString()} ${line}`);
}

const chain = () => resolveChain('aiMemory', CFG);
const textLen = (messages) => messages.reduce((n, m) => n + String(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).length, 0);

function send(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function toReq(body) {
  const rf = body.response_format;
  return {
    messages: body.messages,
    json: Boolean(rf && (rf.type === 'json_object' || rf.type === 'json_schema')),
    schema: rf?.type === 'json_schema' ? rf.json_schema?.schema || null : null,
    temperature: body.temperature,
    maxTokens: body.max_tokens || body.max_completion_tokens,
  };
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, chain: chainStatus(chain(), CFG) });
  }
  if (req.method === 'GET' && req.url.endsWith('/models')) {
    return send(res, 200, { object: 'list', data: [{ id: 'muri-chain', object: 'model' }] });
  }
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
    return send(res, 404, { error: { message: 'not found' } });
  }
  let size = 0;
  const chunks = [];
  req.on('data', (d) => {
    size += d.length;
    if (size > MAX_BODY_BYTES) { send(res, 413, { error: { message: 'body too large' } }); req.destroy(); return; }
    chunks.push(d);
  });
  req.on('end', async () => {
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
      return send(res, 400, { error: { message: 'invalid JSON body' } });
    }
    if (!Array.isArray(body.messages) || !body.messages.length) return send(res, 400, { error: { message: 'messages required' } });
    const r = await complete(toReq(body), { chain: chain(), budgetMs: TOTAL_BUDGET_MS, log, cfg: CFG });
    const inChars = textLen(body.messages);
    if (r.error) {
      log(`FALHOU ${(r.ms / 1000).toFixed(1)}s in=${inChars} tried=[${r.tried.join(', ')}]`);
      return send(res, 503, { error: { message: `all candidates failed: ${r.tried.join(', ')}`, type: 'unavailable' } });
    }
    log(`ok ${r.model} ${(r.ms / 1000).toFixed(1)}s in=${inChars} out=${r.text.length}${r.tried.length ? ` tried=[${r.tried.join(', ')}]` : ''}`);
    const pt = r.usage.prompt_tokens || 0;
    const ct = r.usage.completion_tokens || 0;
    return send(res, 200, {
      id: `chatcmpl-${Date.now().toString(36)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: r.model,
      choices: [{ index: 0, message: { role: 'assistant', content: r.text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct },
    });
  });
});

server.on('error', (e) => {
  // Porta ocupada = outro shim já está de pé (serviço + hook SessionStart): sai quieto.
  if (e.code === 'EADDRINUSE') process.exit(0);
  log(`erro do servidor: ${e.message}`);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => log(`shim ouvindo em 127.0.0.1:${PORT} · cadeia: ${chain().map((c) => c.key).join(' → ') || '(vazia)'}`));
