#!/usr/bin/env node
// Hook Stop/SessionEnd (Claude Code), Stop (Antigravity) e, via
// hooks/codex/obsidian-codex-session.mjs, Stop/SessionEnd do Codex.
//
// Nota viva v2: toda sessão vira uma nota no Obsidian Vault, sem depender do
// agente lembrar de escrever.
//   1. Dump garantido (local, sem LLM, <100 ms): nota em <agente>/sessions/ +
//      linha no Daily cross-agente dailies/Daily-AAAA-MM-DD.md.
//   2. Narrativa (LLM): só sessão substancial, regerada a cada N min de sessão
//      (padrão 15) e de novo no SessionEnd. Roda num WORKER destacado (este
//      mesmo arquivo com MURI_VAULT_WORKER=1), então o Stop volta na hora.
//      O modelo vem da cadeia `llm.narrative` (hooks/muri-llm.mjs); com a
//      cadeia vazia ou toda em cooldown, a nota fica só com o dump.
// Só os blocos <!-- auto-narrativa --> e <!-- auto-dump --> são substituídos.
// Fora deles, anotação manual e notas antigas nunca são tocadas.
//
// Também grava a taxonomia por projeto (projects/<projeto>/<categoria>/), um
// .canvas por sessão e, para agentes cujo conteúdo o ai-memory não captura
// (Antigravity), copia a narrativa para o ai-memory (ponte vault → ai-memory).
//
// Segredos (chaves, tokens, senhas) são mascarados antes de ir para o vault e
// antes de ir para o LLM. Nunca bloqueia nem falha a sessão do agente.

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, appendFileSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import {
  RUNTIME_DIR, STATE_DIR, loadConfig, resolveVault, dateString, timeString, sanitize, cleanText, excerpt,
  yamlQuote, bin, aiMemoryPaths, sqliteQuery, expandHome, appendLog,
} from './muri-common.mjs';
import { complete, resolveChain, triedOnlyQuota } from './muri-llm.mjs';

const CFG = loadConfig();
const VAULT = resolveVault(CFG);
const ALIAS = CFG.alias || 'muri-saver';
const IS_WORKER = process.env.MURI_VAULT_WORKER === '1';
const IS_BACKFILL = process.env.MURI_VAULT_BACKFILL === '1';
const NARRATIVE = CFG.narrative || {};
const MAX_TRANSCRIPT_CHARS = Number(NARRATIVE.maxChars) || 200000;
const REGEN_INTERVAL_MS = (Number(NARRATIVE.intervalMinutes) || 15) * 60 * 1000;
const LANGUAGE = CFG.language || 'pt-BR';
const WORKER_LOCK_MAX_AGE_MS = 12 * 60 * 1000;
const EXIT_RATE_LIMITED = 75;
const ERROR_LOG = join(RUNTIME_DIR, '.generate-summary-error.log');
const VAULT_LLM_LOG = join(RUNTIME_DIR, '.vault-llm.log');
const IGNORE_CWD = Array.isArray(CFG.vaultIgnoreCwd) ? CFG.vaultIgnoreCwd : [];
const BRIDGE_AGENTS = new Set(Array.isArray(NARRATIVE.bridgeToAiMemory) ? NARRATIVE.bridgeToAiMemory : ['antigravity']);
const CODEX_DIR = expandHome(CFG.paths?.codexDir) || join(os.homedir(), '.codex');

function logError(line) {
  appendLog(ERROR_LOG, `${new Date().toISOString()} ${line}`);
}

// process.exitCode preserva o 75 (limite) que o vault-backfill lê.
function allow(extra) {
  process.stdout.write(JSON.stringify(extra || {}));
  process.exit(process.exitCode ?? 0);
}

function readStdin() {
  try {
    // O worker recebe o payload por arquivo (o stdin já foi consumido pelo pai).
    if (IS_WORKER && process.argv[2]) {
      const raw = readFileSync(process.argv[2], 'utf8');
      try { unlinkSync(process.argv[2]); } catch { /* já removido */ }
      return JSON.parse(raw);
    }
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

function grepContains(path, needle) {
  try {
    return readFileSync(path, 'utf8').includes(needle);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ transcript

const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
// Antigravity: nomes de tool variam por versão; o regex erra pro lado de
// "conta como edição" (pior caso: uma narrativa a mais, nunca uma sessão perdida).
const FILE_EDIT_TOOL_PATTERN_AGY = /write|edit|replace.*file|create.*file|notebook/i;
const MIN_SUBSTANTIAL_USER_MESSAGES = 2;
const MIN_SUBSTANTIAL_DURATION_MS = 2 * 60 * 1000;
const MAX_RAW_DUMP_CHARS = 60000;

function readLines(path) {
  try {
    return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  } catch {
    return [];
  }
}

function parse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isRealUserPromptText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.startsWith('<command-name>') || t.startsWith('<local-command-stdout>')) return false; // /clear, /model...
  return !t.includes('<local-command-caveat>');
}

function isUserEntry(obj) {
  const role = obj.type || obj.role || '';
  return (role === 'user' || role === 'USER_INPUT') && !obj.isMeta;
}

function isAssistantEntry(obj) {
  const role = obj.type || obj.role || '';
  return role === 'assistant' || role === 'PLANNER_RESPONSE' || role === 'model';
}

function userTextOf(obj) {
  const content = obj.message?.content ?? obj.content;
  if (typeof content === 'string') return isRealUserPromptText(content) ? content : null;
  if (Array.isArray(content)) return content.find((c) => c?.type === 'text' && isRealUserPromptText(c.text))?.text || null;
  return null;
}

function toolCallsOf(obj) {
  const content = obj.message?.content ?? obj.content;
  const calls = Array.isArray(content) ? content.filter((c) => c?.type === 'tool_use').map((c) => ({ name: c.name, input: c.input || {} })) : [];
  if (Array.isArray(obj.tool_calls)) for (const tc of obj.tool_calls) calls.push({ name: tc.name, input: tc.args || {}, agy: true });
  return calls;
}

// Texto pro LLM: mensagens + ações, sem tags de sistema e com segredos mascarados.
function extractTranscriptExcerpt(transcriptPath) {
  const parts = [];
  for (const line of readLines(transcriptPath)) {
    const obj = parse(line);
    if (!obj) continue;
    const role = obj.type || obj.role || '';
    const content = obj.message?.content ?? obj.content;
    let text = '';
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) {
      text = content.map((c) => {
        if (c?.type === 'text') return c.text;
        if (c?.type === 'tool_use') {
          const i = c.input || {};
          const target = i.TargetFile || i.path || i.file_path || i.command || i.CommandLine || i.query || '';
          return `[Ação: ${c.name || ''}${target ? ` -> ${String(target).slice(0, 150)}` : ''}]`;
        }
        if (c?.type === 'tool_result' && c.is_error) return '[Erro na ferramenta]';
        return '';
      }).filter(Boolean).join(' ');
    }
    if (Array.isArray(obj.tool_calls)) {
      const calls = obj.tool_calls.map((tc) => {
        const a = tc.args || {};
        const target = a.TargetFile || a.path || a.CommandLine || a.query || '';
        return `[Ação: ${tc.name || ''}${target ? ` -> ${String(target).slice(0, 150)}` : ''}]`;
      }).join(' ');
      if (calls) text = text ? `${text} ${calls}` : calls;
    }
    if (!text || text.includes('<local-command-caveat>')) continue;
    // CLAUDE.md, listas de skills e lembretes injetados não são trabalho da sessão.
    text = cleanText(text).trim();
    if (text) parts.push(`${role}: ${text}`);
  }
  let out = parts.join('\n');
  if (out.length > MAX_TRANSCRIPT_CHARS) {
    // 25% do começo (o pedido) + 75% do fim (desenvolvimento e conclusão).
    const head = Math.floor(MAX_TRANSCRIPT_CHARS * 0.25);
    out = `${out.slice(0, head)}\n\n[... trecho intermediário omitido ...]\n\n${out.slice(-(MAX_TRANSCRIPT_CHARS - head))}`;
  }
  return out;
}

// Metadados locais pro bloco de dump: arquivos tocados (transcript + git),
// comandos executados e tasks. O git tem timeout curto e nunca lança.
function extractLocalMetadata(transcriptPath, cwd) {
  const filesTouched = new Set();
  const taskStatuses = new Map();
  let commandCount = 0;
  for (const line of readLines(transcriptPath)) {
    const obj = parse(line);
    if (!obj) continue;
    for (const c of toolCallsOf(obj)) {
      commandCount++;
      const path = c.input.file_path || c.input.TargetFile || c.input.path;
      if (path && (FILE_EDIT_TOOLS.has(c.name) || FILE_EDIT_TOOL_PATTERN_AGY.test(c.name || ''))) filesTouched.add(String(path));
      const taskId = c.input.taskId || c.input.id;
      if (c.name === 'TaskUpdate' && c.input.status) taskStatuses.set(taskId || String(taskStatuses.size), c.input.status);
      else if (c.name === 'TaskCreate' && !taskStatuses.has(taskId)) taskStatuses.set(taskId || String(taskStatuses.size), 'pending');
    }
  }
  try {
    const out = execFileSync('git', ['-C', cwd, 'status', '--porcelain'], {
      encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
    });
    out.split('\n').filter(Boolean).forEach((l) => filesTouched.add(l.slice(3).trim()));
  } catch {
    // não é repo git ou git ausente
  }
  const statuses = [...taskStatuses.values()];
  const done = statuses.filter((s) => /complet|done|conclu/i.test(s)).length;
  return {
    filesTouched: [...filesTouched].slice(0, 30),
    commandCount,
    taskSummary: statuses.length ? `${done}/${statuses.length} tasks concluídas` : null,
  };
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function analyzeSignals(transcriptPath) {
  let userMessageCount = 0;
  let fileEditCount = 0;
  let firstTs = null;
  let lastTs = null;
  const userTexts = [];
  for (const line of readLines(transcriptPath)) {
    const obj = parse(line);
    if (!obj) continue;
    const t = Date.parse(obj.timestamp || obj.created_at || '');
    if (!Number.isNaN(t)) {
      if (firstTs === null || t < firstTs) firstTs = t;
      if (lastTs === null || t > lastTs) lastTs = t;
    }
    if (isUserEntry(obj)) {
      const text = userTextOf(obj);
      if (text) {
        userMessageCount++;
        userTexts.push(cleanText(text));
      }
    }
    for (const c of toolCallsOf(obj)) {
      if (FILE_EDIT_TOOLS.has(c.name) || (c.agy && FILE_EDIT_TOOL_PATTERN_AGY.test(c.name || ''))) fileEditCount++;
    }
  }
  // Só o que o usuário digitou: a lista de skills e o CLAUDE.md injetados
  // sempre contêm o nome da skill e geravam falso positivo em quase toda sessão.
  const names = [...new Set(['muri-saver', ALIAS])].map((n) => escapeRe(n).replace(/\\?-/g, '[\\s-]?'));
  const saverRe = new RegExp(names.join('|'), 'i');
  return {
    userMessageCount,
    fileEditCount,
    durationMs: firstTs !== null && lastTs !== null ? lastTs - firstTs : null,
    isSaverMode: userTexts.some((t) => saverRe.test(t)) || process.env.MURI_SAVER === '1',
  };
}

// Conversa longa sem edição (pesquisa, decisão, entrevista) também merece narrativa.
function isSubstantialSession(s) {
  const longEnough = s.durationMs === null ? true : s.durationMs >= MIN_SUBSTANTIAL_DURATION_MS;
  return s.userMessageCount >= MIN_SUBSTANTIAL_USER_MESSAGES && longEnough && (s.fileEditCount > 0 || s.userMessageCount >= 4);
}

function extractRawExchanges(transcriptPath) {
  const exchanges = [];
  for (const line of readLines(transcriptPath)) {
    const obj = parse(line);
    if (!obj) continue;
    const content = obj.message?.content ?? obj.content;
    if (isUserEntry(obj)) {
      let text = null;
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content)) text = content.find((c) => c?.type === 'text')?.text || null;
      if (isRealUserPromptText(text)) exchanges.push({ role: 'user', text: text.trim() });
    } else if (isAssistantEntry(obj)) {
      if (typeof content === 'string' && content.trim()) exchanges.push({ role: 'assistant', text: content.trim() });
      else if (Array.isArray(content)) {
        const text = content.filter((c) => c?.type === 'text').map((c) => c.text).filter(Boolean).join('\n\n').trim();
        if (text) exchanges.push({ role: 'assistant', text });
      }
    }
  }
  return exchanges;
}

function buildRawDumpBody(exchanges) {
  if (exchanges.length === 0) return '_Nenhum prompt substantivo capturado nesta sessão (provavelmente só comandos rápidos)._';
  let body = exchanges
    .map((e) => `${e.role === 'user' ? '🧑 **Usuário**' : '🤖 **IA**'}\n\n${sanitize(e.text)}`)
    .join('\n\n---\n\n');
  if (body.length > MAX_RAW_DUMP_CHARS) {
    const head = Math.floor(MAX_RAW_DUMP_CHARS * 0.5);
    body = `${body.slice(0, head)}\n\n[... trecho intermediário omitido ...]\n\n${body.slice(-(MAX_RAW_DUMP_CHARS - head))}`;
  }
  return body;
}

// AGY grava transcript.jsonl (truncado) e transcript_full.jsonl lado a lado.
function resolveFullTranscript(path) {
  if (path && basename(path) === 'transcript.jsonl') {
    const full = join(dirname(path), 'transcript_full.jsonl');
    if (existsSync(full)) return full;
  }
  return path;
}

// Converte o rollout do Codex (~/.codex/sessions/**/rollout-*.jsonl) pro
// formato do Claude Code, pra reaproveitar toda a extração. Mensagens "user"
// injetadas pelo próprio Codex (AGENTS.md, environment_context...) não contam.
const CODEX_INJECTED = /^\s*(# AGENTS\.md instructions|<environment_context>|<user_instructions>|<permissions|<INSTRUCTIONS>|<skills?_instructions>|<turn_aborted>)/;
const MAX_ROLLOUT_BYTES = 60 * 1024 * 1024;

function normalizeCodexRollout(rolloutPath, key) {
  try {
    if (statSync(rolloutPath).size > MAX_ROLLOUT_BYTES) return null;
    const out = [];
    for (const line of readLines(rolloutPath)) {
      const d = parse(line);
      if (!d || d.type !== 'response_item') continue;
      const p = d.payload || {};
      const ts = d.timestamp;
      if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
        const text = (p.content || []).map((c) => c?.text || '').join('\n').trim();
        if (!text) continue;
        if (p.role === 'user') {
          if (!CODEX_INJECTED.test(text)) out.push({ type: 'user', timestamp: ts, message: { content: text } });
        } else {
          out.push({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'text', text }] } });
        }
      } else if (p.type === 'function_call' || p.type === 'custom_tool_call') {
        let args = {};
        try { args = typeof p.arguments === 'string' ? JSON.parse(p.arguments) : (p.arguments || {}); } catch { /* args inválidos */ }
        const isPatch = p.name === 'apply_patch';
        const file = isPatch && typeof p.input === 'string' ? (p.input.match(/\*\*\* (?:Update|Add) File: (.+)/) || [])[1] : undefined;
        const cmd = Array.isArray(args.command) ? args.command.join(' ') : (args.cmd || args.command);
        out.push({
          type: 'assistant',
          timestamp: ts,
          message: { content: [{ type: 'tool_use', name: isPatch ? 'Edit' : p.name, input: { file_path: file, command: typeof cmd === 'string' ? cmd.slice(0, 300) : undefined } }] },
        });
      }
    }
    const tmp = join(os.tmpdir(), `muri-codex-${key}.jsonl`);
    writeFileSync(tmp, out.map((o) => JSON.stringify(o)).join('\n'));
    return tmp;
  } catch {
    return null;
  }
}

function findCodexRollout(sessionId) {
  if (!sessionId) return null;
  const stack = [join(CODEX_DIR, 'sessions')];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name.endsWith(`${sessionId}.jsonl`)) return full;
    }
  }
  return null;
}

// ------------------------------------------------------------------ narrativa

// Chave ASCII que o LLM devolve == nome da pasta (sem acento, de propósito).
const CATEGORY_DIRS = {
  bug: 'bugs', pedido: 'pedidos', melhoria: 'melhorias', correcao: 'correcoes', prompt: 'prompts',
  duvida: 'duvidas', ideia: 'ideias', decisao: 'decisoes', 'divida-tecnica': 'divida-tecnica',
  pesquisa: 'pesquisa', release: 'releases', risco: 'riscos',
};
const CATEGORY_EMOJI = {
  bug: '🐛', pedido: '📩', melhoria: '✨', correcao: '🔧', prompt: '💬', duvida: '❓', ideia: '💡',
  decisao: '🧭', 'divida-tecnica': '🩹', pesquisa: '🔍', release: '🚀', risco: '⚠️',
};
// Categorias com ciclo de vida ganham status; um subconjunto ganha prioridade.
const STATUS_CATEGORIES = new Set(['bug', 'pedido', 'melhoria', 'risco', 'divida-tecnica']);
const PRIORITY_CATEGORIES = new Set(['bug', 'risco', 'divida-tecnica']);
const VALID_ORIGENS = new Set(['usuario', 'ia', 'sistema']);

function listKnownProjects() {
  try {
    return readdirSync(join(VAULT, 'projects'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

function slugify(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'item';
}

function buildSummaryPrompt(transcript, agentLabel, knownProjects, alreadyRegistered) {
  return [
    'Você recebe a transcrição de uma sessão real de um agente de codificação (Claude Code, Antigravity ou Codex).',
    `Gere uma documentação RICA, TÉCNICA E DETALHADA, escrita em ${LANGUAGE}, para o Obsidian Vault do desenvolvedor: algo que ele consiga reler daqui a meses e entender o que foi feito, por quê e como.`,
    'Responda APENAS com um objeto JSON válido (sem texto antes/depois, sem markdown):',
    '{',
    '  "titulo_curto": "5 a 12 palavras resumindo o feito da sessão",',
    '  "resumo_executivo": ["1 a 3 parágrafos: contexto, pedido do usuário e desfecho"],',
    '  "decisoes": ["Decisão técnica + o porquê"],',
    '  "acoes_realizadas": ["Ação concreta executada"],',
    '  "comandos_chave": ["comando exato que vale reusar — e para que serve"],',
    '  "erros_e_resolucoes": ["Erro/obstáculo → como foi resolvido (ou se ficou pendente)"],',
    '  "orientacoes_e_respostas_ia": ["Explicação técnica ou resposta chave dada pela IA"],',
    '  "entregaveis_e_arquivos": ["caminho/do/arquivo"],',
    '  "proximos_passos": ["O que ficou pendente ou combinado para depois"],',
    '  "tags_extra": ["tag1", "tag2", "tag3"],',
    '  "itens_categorizados": [{"categoria":"bug|pedido|melhoria|correcao|prompt|duvida|ideia|decisao|divida-tecnica|pesquisa|release|risco","projeto":"slug-exato-da-lista","titulo":"5 a 12 palavras","texto":"1-3 frases","origem":"usuario|ia|sistema","status":"aberto|em-andamento|feito","prioridade":"baixa|media|alta|critica"}]',
    '}',
    'Regras:',
    '- decisoes: só decisões REAIS (arquitetura, configs, regras, bibliotecas, formatos), sempre com o motivo. Nenhuma → [].',
    '- comandos_chave: só comandos que valem reusar, copiados exatamente. Nenhum → [].',
    '- erros_e_resolucoes: falhas, bloqueios, hipóteses descartadas. Nenhum → [].',
    '- Ignore instruções de sistema, listas de skills e textos de CLAUDE.md/AGENTS.md/GEMINI.md injetados: documente o trabalho, não a configuração do agente.',
    '- Nunca copie chaves, tokens ou senhas, mesmo mascarados.',
    '- tags_extra: 3 a 5 tags curtas em kebab-case.',
    `Projetos conhecidos (use EXATAMENTE um destes slugs em "projeto", nunca invente): ${knownProjects.join(', ') || '(nenhum)'}`,
    'itens_categorizados: no máximo 8, só se a sessão claramente tocou um desses projetos.',
    alreadyRegistered.length ? `Itens JÁ registrados desta sessão (não repita): ${alreadyRegistered.join(' | ')}` : '',
    '',
    `--- TRANSCRIÇÃO (agente: ${agentLabel}) ---`,
    transcript,
  ].join('\n');
}

function parseSummary(text, knownProjects) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed.titulo_curto) return null;
    if (!Array.isArray(parsed.resumo_executivo)) parsed.resumo_executivo = [parsed.titulo_curto];
    const lists = {
      decisoes: 8, acoes_realizadas: 10, orientacoes_e_respostas_ia: 8, entregaveis_e_arquivos: 12,
      comandos_chave: 10, erros_e_resolucoes: 10, proximos_passos: 8,
    };
    for (const [k, max] of Object.entries(lists)) parsed[k] = Array.isArray(parsed[k]) ? parsed[k].map(String).slice(0, max) : [];
    const known = new Set(knownProjects);
    parsed.itens_categorizados = (Array.isArray(parsed.itens_categorizados) ? parsed.itens_categorizados : [])
      .filter((it) => it && CATEGORY_DIRS[it.categoria] && known.has(it.projeto) && it.titulo)
      .map((it) => ({
        ...it,
        origem: VALID_ORIGENS.has(it.origem) ? it.origem : 'ia',
        status: STATUS_CATEGORIES.has(it.categoria) ? (it.status || 'aberto') : '',
        prioridade: PRIORITY_CATEGORIES.has(it.categoria) ? (it.prioridade || 'media') : '',
      }))
      .slice(0, 8);
    return parsed;
  } catch {
    return null;
  }
}

async function generateSummary(transcript, agentLabel, knownProjects, alreadyRegistered) {
  const chain = resolveChain(IS_BACKFILL ? 'backfill' : 'narrative', CFG);
  if (!transcript || chain.length === 0) return { summary: null, rateLimited: false };
  const prompt = buildSummaryPrompt(transcript, agentLabel, knownProjects, alreadyRegistered);
  const r = await complete({ messages: [{ role: 'user', content: prompt }], json: true }, {
    chain, budgetMs: 20 * 60 * 1000, log: (l) => logError(`[narrativa] ${l}`), cfg: CFG,
  });
  if (r.error) {
    logError(`[narrativa] nenhum modelo respondeu: ${r.tried.join(', ')}`);
    return { summary: null, rateLimited: triedOnlyQuota(r.tried) };
  }
  const summary = parseSummary(r.text, knownProjects);
  if (!summary) {
    logError(`[narrativa] ${r.model} devolveu JSON sem titulo_curto`);
    return { summary: null, rateLimited: false };
  }
  // Uma linha por narrativa, lida pelo relatório de economia (trabalho fora da cota do Claude).
  appendLog(VAULT_LLM_LOG, `${new Date().toISOString()}\tok\t${r.model}\t${(r.ms / 1000).toFixed(1)}s\tin_chars=${prompt.length}\tout_chars=${r.text.length}\t${agentLabel}`);
  return { summary, model: r.model };
}

// ------------------------------------------------------------------ escrita

const NARR_START = '<!-- auto-narrativa:start -->';
const NARR_END = '<!-- auto-narrativa:end -->';
const DUMP_START = '<!-- auto-dump:start -->';
const DUMP_END = '<!-- auto-dump:end -->';

function readState(key) {
  try {
    return JSON.parse(readFileSync(join(STATE_DIR, `${key}.json`), 'utf8'));
  } catch {
    return {};
  }
}

function writeState(key, state) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(join(STATE_DIR, `${key}.json`), JSON.stringify(state));
  } catch { /* best-effort */ }
}

function findSessionNote(sessionsDir, idShort) {
  try {
    const name = readdirSync(sessionsDir).filter((n) => n.endsWith('.md') && n.includes(idShort)).sort()[0];
    return name ? join(sessionsDir, name) : null;
  } catch {
    return null;
  }
}

function bulletSection(title, items, fmt = (x) => `- ${x}`) {
  return items.length ? `\n### ${title}\n\n${items.map((x) => fmt(sanitize(x))).join('\n')}\n` : '';
}

function buildNarrativeBlock(summary, model, when) {
  const resumo = (summary.resumo_executivo || []).map(sanitize).join('\n\n');
  return `${NARR_START}
## 🧠 Narrativa — ${sanitize(summary.titulo_curto)}

> [!info] Gerada por \`${model}\` em ${when}. Bloco regerado pelo hook durante a sessão; anotações manuais vão fora dele.

### 📝 Síntese Executiva

${resumo}
${bulletSection('🧭 Decisões', summary.decisoes)}${bulletSection('⚡ Ações Realizadas', summary.acoes_realizadas)}${bulletSection('⌨️ Comandos-chave', summary.comandos_chave, (c) => `- \`${c.replace(/`/g, "'")}\``)}${bulletSection('🩹 Erros & Resoluções', summary.erros_e_resolucoes)}${bulletSection('💡 Orientações da IA', summary.orientacoes_e_respostas_ia)}${bulletSection('📦 Arquivos & Entregáveis', summary.entregaveis_e_arquivos, (f) => `- \`${f}\``)}${bulletSection('⏭️ Próximos Passos', summary.proximos_passos)}
${NARR_END}`;
}

function buildDumpBlock(exchanges, { filesTouched = [], commandCount = 0, taskSummary = null }) {
  const meta = [`- **Comandos/ações executados:** ${commandCount}`];
  if (taskSummary) meta.push(`- **Tasks:** ${taskSummary}`);
  meta.push(filesTouched.length
    ? `- **Arquivos tocados (${filesTouched.length}):** ${filesTouched.map((f) => `\`${sanitize(f)}\``).join(', ')}`
    : '- **Arquivos tocados:** nenhum detectado');
  return `${DUMP_START}
## 📊 Metadados Locais (extração sem LLM)

${meta.join('\n')}

## 💬 Prompts & Respostas (dump local)

${buildRawDumpBody(exchanges)}
${DUMP_END}`;
}

function buildSessionFile({ agentLabel, agentTag, idShort, id, dateStr, timeStr, cwd, exchanges, localMeta, isSaverMode }) {
  const first = exchanges.find((e) => e.role === 'user');
  const titulo = first ? excerpt(first.text, 80) : 'Sessão sem prompts registrados';
  const icon = { claude: '🟧', antigravity: '🤖', codex: '🟦' }[agentTag] || '🤖';
  const tags = ['session', agentTag, ...(isSaverMode ? [ALIAS] : [])];
  return `---
title: ${yamlQuote(`Sessão ${agentLabel} ${idShort} — ${titulo}`)}
agent: ${agentTag}
date_start: ${dateStr}
session_id: ${idShort}
session_uuid: ${id}
cwd: ${yamlQuote(sanitize(cwd || ''))}
tier: episodic
formato: v2
generated: auto
tags:
${tags.map((t) => `  - ${t}`).join('\n')}
---

# ${icon} Sessão ${agentLabel} ${idShort}

🏷️ **Tags:** ${tags.map((t) => `#${t}`).join(' ')}

- **ID da Sessão:** \`${idShort}\` (\`${id}\`)
- **Início:** ${dateStr} às ${timeStr} · **Diretório:** \`${sanitize(cwd || '?')}\`
- **Nota viva:** a narrativa é regerada durante a sessão e no encerramento.

${NARR_START}
_Narrativa pendente: é gerada quando a sessão fica substancial._
${NARR_END}

${buildDumpBlock(exchanges, localMeta)}

---

## 🌐 Conexões Globais no Grafo
[[${agentTag}/README|Central ${agentLabel}]] [[dailies/Daily-${dateStr}|Diário de Bordo ${dateStr}]]
`;
}

function replaceBlock(content, start, end, block) {
  const i = content.indexOf(start);
  const j = content.indexOf(end);
  if (i === -1 || j === -1 || j < i) return null;
  return content.slice(0, i) + block + content.slice(j + end.length);
}

// Só notas v2 têm o bloco de dump marcado; nota antiga fica intacta.
function refreshDumpBlock(sessionPath, transcriptPath, cwd) {
  try {
    const content = readFileSync(sessionPath, 'utf8');
    if (!content.includes(DUMP_START)) return;
    const refreshed = replaceBlock(content, DUMP_START, DUMP_END,
      buildDumpBlock(extractRawExchanges(transcriptPath), extractLocalMetadata(transcriptPath, cwd)));
    if (refreshed !== null && refreshed !== content) writeFileSync(sessionPath, refreshed);
  } catch { /* best-effort */ }
}

// Nota antiga (sem marcadores): insere o bloco antes da primeira seção "## ".
function insertNarrative(content, block) {
  const replaced = replaceBlock(content, NARR_START, NARR_END, block);
  if (replaced !== null) return replaced;
  const fmEnd = content.startsWith('---') ? content.indexOf('\n---', 3) + 4 : 0;
  const idx = content.indexOf('\n## ', fmEnd);
  if (idx === -1) return `${content.trimEnd()}\n\n${block}\n`;
  return `${content.slice(0, idx)}\n${block}\n${content.slice(idx)}`;
}

function upsertFrontmatter(content, kv) {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  let fm = content.slice(0, end);
  for (const [k, v] of Object.entries(kv)) {
    const re = new RegExp(`^${k}:.*$`, 'm');
    fm = re.test(fm) ? fm.replace(re, () => `${k}: ${v}`) : `${fm}\n${k}: ${v}`;
  }
  return fm + content.slice(end);
}

function dailySkeleton(dateStr, agentTag) {
  return `---
title: Diário de Bordo — ${dateStr}
kind: fact
pinned: true
tier: episodic
tags:
  - daily
  - session
  - log
  - ${agentTag}
  - ${ALIAS}
---

# 📅 Diário de Bordo — ${dateStr}

Registro cronológico das sessões de IA do dia ${dateStr.split('-').reverse().join('/')}. Gerado automaticamente.

---

## 📋 Sessões do Dia

<!-- ENTRIES -->

---

## 🌐 Conexões Globais no Grafo
[[Hub-Projects|Central de Projetos]] [[Hub-Agents|Central de Agentes]]
`;
}

function appendDailyEntry(dailyPath, dateStr, agentTag, entry) {
  if (!existsSync(dailyPath)) {
    writeFileSync(dailyPath, dailySkeleton(dateStr, agentTag).replace('<!-- ENTRIES -->', `${entry}\n<!-- ENTRIES -->`));
    return;
  }
  const content = readFileSync(dailyPath, 'utf8');
  if (content.includes('<!-- ENTRIES -->')) {
    writeFileSync(dailyPath, content.replace('<!-- ENTRIES -->', () => `${entry}\n<!-- ENTRIES -->`));
    return;
  }
  // Daily escrito à mão (sem marcador): insere antes das conexões, nunca sobrescreve.
  const marker = '## 🌐 Conexões Globais no Grafo';
  if (content.includes(marker)) writeFileSync(dailyPath, content.replace(marker, () => `${entry}\n\n---\n\n${marker}`));
  else appendFileSync(dailyPath, `\n\n---\n\n${entry}\n`);
}

// "↳ Narrativa" no Daily: atualizada no lugar, logo abaixo da entrada da sessão.
function upsertDailyNarrative(dailyPath, idShort, text) {
  try {
    if (!existsSync(dailyPath)) return false;
    const marker = `<!-- narr:${idShort} -->`;
    const line = `- ↳ **Narrativa:** ${excerpt(text, 400)} ${marker}`;
    const lines = readFileSync(dailyPath, 'utf8').split('\n');
    const existing = lines.findIndex((l) => l.includes(marker));
    if (existing !== -1) lines[existing] = line;
    else {
      const header = lines.findIndex((l) => l.startsWith('### ') && l.includes(idShort));
      if (header === -1) return false;
      let j = header + 1;
      while (j < lines.length && lines[j].startsWith('- ')) j++;
      lines.splice(j, 0, line);
    }
    writeFileSync(dailyPath, lines.join('\n'));
    return true;
  } catch {
    return false;
  }
}

// Notas atômicas por categoria em projects/<projeto>/<categoria>/, linkadas à
// sessão. state.items guarda o que já foi gravado: item repetido é pulado e
// nota que o usuário editou (ex.: status → feito) nunca é sobrescrita.
function writeClassifiedNotes(summary, { dateStr, idShort, agentTag, agentLabel, sessionFileName, state }) {
  const sessionLink = `${agentTag}/sessions/${sessionFileName.replace(/\.md$/, '')}`;
  const touched = new Set();
  state.items = state.items || [];
  for (const item of summary.itens_categorizados || []) {
    const key = `${item.categoria}:${slugify(item.titulo)}`;
    if (state.items.includes(key)) continue;
    try {
      const dir = join(VAULT, 'projects', item.projeto, CATEGORY_DIRS[item.categoria]);
      mkdirSync(dir, { recursive: true });
      const fileName = `${item.categoria}-${dateStr}-${idShort}-${String(state.items.length + 1).padStart(2, '0')}-${slugify(item.titulo)}.md`;
      state.items.push(key);
      const filePath = join(dir, fileName);
      if (existsSync(filePath)) continue;
      const titulo = sanitize(item.titulo);
      const meta = [item.status ? `**Status:** ${item.status}` : null, item.prioridade ? `**Prioridade:** ${item.prioridade}` : null].filter(Boolean).join(' · ');
      writeFileSync(filePath, `---
title: ${yamlQuote(titulo)}
projeto: ${item.projeto}
categoria: ${item.categoria}
origem: ${item.origem}
${item.status ? `status: ${item.status}\n` : ''}${item.prioridade ? `prioridade: ${item.prioridade}\n` : ''}origem_sessao: "[[${sessionLink}]]"
date: ${dateStr}
generated: auto
tags:
  - ${item.categoria}
  - ${item.projeto}
---

# ${CATEGORY_EMOJI[item.categoria] || '📝'} ${titulo}

🏷️ **Tags:** #${item.categoria} #${item.projeto}

- **Projeto:** [[projects/${item.projeto}/README|${item.projeto}]]
${meta ? `- ${meta}\n` : ''}- **Origem:** ${item.origem}
- **Sessão de origem:** [[${sessionLink}|Sessão ${agentLabel} ${idShort}]]
- **Data:** ${dateStr}

${sanitize(item.texto || '')}
`);
      touched.add(item.projeto);
    } catch { /* best-effort */ }
  }
  return touched;
}

// Recalcula a contagem por categoria no bloco marcado do README do projeto.
function updateProjectDashboard(projeto) {
  try {
    const projectDir = join(VAULT, 'projects', projeto);
    const readmePath = join(projectDir, 'README.md');
    if (!existsSync(readmePath)) return;
    const rows = Object.entries(CATEGORY_DIRS).map(([key, dirName]) => {
      let count = 0;
      try { count = readdirSync(join(projectDir, dirName)).filter((f) => f.endsWith('.md') && f !== 'README.md').length; } catch { count = 0; }
      return `| ${CATEGORY_EMOJI[key] || ''} ${dirName} | ${count} |`;
    });
    const block = `<!-- CATEGORY_COUNTS -->\n| Categoria | Itens |\n|---|---|\n${rows.join('\n')}\n\n_Atualizado automaticamente pelo hook em ${dateString()}._\n<!-- /CATEGORY_COUNTS -->`;
    const content = readFileSync(readmePath, 'utf8');
    writeFileSync(readmePath, content.includes('<!-- CATEGORY_COUNTS -->') && content.includes('<!-- /CATEGORY_COUNTS -->')
      ? content.replace(/<!-- CATEGORY_COUNTS -->[\s\S]*?<!-- \/CATEGORY_COUNTS -->/, () => block)
      : `${content.trimEnd()}\n\n## 📊 Dashboard (auto)\n${block}\n`);
  } catch { /* best-effort */ }
}

function buildSessionCanvas({ agentLabel, agentTag, idShort, dateStr, timeStr, summary, sessionFileName }) {
  const resumo = (summary.resumo_executivo || []).slice(0, 2).map(sanitize).join('\n\n');
  const decisoes = summary.decisoes.slice(0, 4).map(sanitize);
  const acoes = summary.acoes_realizadas.slice(0, 4).map(sanitize);
  const summaryText = [
    `### 📝 Síntese Executiva\n\n${resumo}`,
    decisoes.length ? `**🧭 Decisões:**\n${decisoes.map((d) => `• ${d}`).join('\n')}` : null,
    acoes.length ? `**⚡ Ações:**\n${acoes.map((a) => `• ${a}`).join('\n')}` : null,
  ].filter(Boolean).join('\n\n');
  const nodes = [
    { id: 'agent-node', type: 'text', text: `## Sessão ${agentLabel} \`${idShort}\`\n\n**Data:** ${dateStr} às ${timeStr}\n**Tema:** ${sanitize(summary.titulo_curto)}`, x: -400, y: -100, width: 340, height: 200, color: agentTag === 'claude' ? '1' : '4' },
    { id: 'summary-node', type: 'text', text: summaryText, x: 0, y: -150, width: 480, height: 380, color: '3' },
    { id: 'session-file-node', type: 'file', file: `${agentTag}/sessions/${sessionFileName}`, x: 540, y: -200, width: 400, height: 420 },
  ];
  const edges = [
    { id: 'edge-agent-summary', fromNode: 'agent-node', fromSide: 'right', toNode: 'summary-node', toSide: 'left' },
    { id: 'edge-summary-file', fromNode: 'summary-node', fromSide: 'right', toNode: 'session-file-node', toSide: 'left' },
  ];
  (summary.itens_categorizados || []).slice(0, 5).forEach((item, idx) => {
    const nodeId = `cat-item-${idx}`;
    nodes.push({
      id: nodeId, type: 'text', x: idx * 320 - 200, y: 260, width: 300, height: 220, color: '5',
      text: `#### ${CATEGORY_EMOJI[item.categoria] || '📌'} ${item.categoria.toUpperCase()}: ${sanitize(item.titulo)}\n\n**Projeto:** ${item.projeto}\n${item.status ? `**Status:** ${item.status}\n` : ''}${sanitize(item.texto || '')}`,
    });
    edges.push({ id: `edge-summary-${nodeId}`, fromNode: 'summary-node', fromSide: 'bottom', toNode: nodeId, toSide: 'top' });
  });
  return JSON.stringify({ nodes, edges }, null, 2);
}

// Ponte vault → ai-memory. Do Antigravity o ai-memory só captura o ciclo de
// vida das ferramentas (sem prompt nem resposta), e o auto-improve rejeita a
// sessão por falta de conteúdo. A narrativa vira a página
// narratives/<data>-<agente>-<id>.md no projeto em que o ai-memory registrou a
// sessão (mesmo id dos dois lados). Claude e Codex o próprio ai-memory consolida.
async function aiMemoryScopeForSession(id) {
  const hex = String(id).replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{8,32}$/.test(hex)) return null;
  const rows = await sqliteQuery(aiMemoryPaths().dbPath,
    'SELECT w.name AS workspace, p.name AS project FROM sessions s JOIN projects p ON p.id = s.project_id '
    + `JOIN workspaces w ON w.id = s.workspace_id WHERE lower(hex(s.id)) LIKE '${hex}%' LIMIT 2;`);
  return rows && rows.length === 1 && rows[0].workspace && rows[0].project ? rows[0] : null;
}

async function bridgeNarrativeToAiMemory({ agentTag, agentLabel, id, idShort, noteDate, summary, block, sessionPath }) {
  if (process.env.MURI_AIM_BRIDGE === '0' || !BRIDGE_AGENTS.has(agentTag)) return;
  const aim = bin('ai-memory');
  if (!aim) return;
  const scope = await aiMemoryScopeForSession(id);
  if (!scope) return;
  const body = `${block.replace(NARR_START, '').replace(NARR_END, '').replace(/^> \[!info\].*\n/m, '').trim()}\n\n---\nNota completa no vault: \`${agentTag}/sessions/${basename(sessionPath)}\` (sessão \`${id}\`).\n`;
  try {
    execFileSync(aim.cmd, [...aim.pre, 'write-page', '--workspace', scope.workspace, '--project', scope.project,
      '--path', `narratives/${noteDate}-${agentTag}-${idShort}.md`,
      '--title', `Sessão ${agentLabel} ${noteDate} — ${String(summary.titulo_curto || idShort).replace(/\s+/g, ' ').slice(0, 120)}`,
      '--tier', 'episodic', '-t', 'session', '-t', agentTag, '-t', 'narrativa', '--body', body],
    { stdio: 'ignore', timeout: 20000, windowsHide: true });
  } catch (e) {
    logError(`aim-bridge ${agentTag}-${idShort}: ${String(e.message || e).slice(0, 300)}`);
  }
}

// ------------------------------------------------------------------ worker

// Dispara este mesmo script destacado pra gerar a narrativa sem segurar o
// Stop. O lock por sessão evita workers duplicados (o Stop roda a cada turno).
function spawnSummaryWorker(input, key) {
  const lockPath = join(os.tmpdir(), `muri-vault-gen-${key}.lock`);
  try {
    if (existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs < WORKER_LOCK_MAX_AGE_MS) return true;
    writeFileSync(lockPath, String(process.pid));
    const inputPath = join(os.tmpdir(), `muri-vault-gen-${key}-${Date.now()}.json`);
    writeFileSync(inputPath, JSON.stringify(input));
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), inputPath], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, MURI_VAULT_WORKER: '1', MURI_VAULT_LOCK: lockPath },
    });
    child.unref();
    return true;
  } catch {
    try { unlinkSync(lockPath); } catch { /* sem lock */ }
    return false;
  }
}

function detectAgent(input) {
  if (input.agent === 'codex') return { agentTag: 'codex', agentLabel: 'Codex', agentFileTag: 'Codex' };
  if (input.conversationId) return { agentTag: 'antigravity', agentLabel: 'Antigravity', agentFileTag: 'AGY' };
  return { agentTag: 'claude', agentLabel: 'Claude', agentFileTag: 'Claude' };
}

async function main() {
  if (!VAULT) return allow(); // Obsidian desativado nesta instalação
  // Anti-recursão: chamadas headless do próprio muri-saver não são sessões do usuário.
  if (!IS_BACKFILL && (process.env.MURI_SAVER_OBSIDIAN_GEN === '1' || process.env.MURI_DELEGATE === '1')) return allow();

  const input = readStdin();
  const { agentTag, agentLabel, agentFileTag } = detectAgent(input);
  const id = input.session_id || input.conversationId || '';
  if (!id) return allow();
  const cwd = input.cwd || process.cwd();
  if (IGNORE_CWD.some((p) => p && String(cwd).includes(p))) return allow();

  const idShort = agentTag === 'codex' ? id.replace(/[^a-zA-Z0-9_-]/g, '').slice(-12) : id.replace(/-/g, '').slice(0, 8);
  const stateKey = `${agentTag}-${idShort}`;
  // No Codex, o worker recebe o rollout original (reprocessar o já normalizado o zeraria).
  let transcriptPath = resolveFullTranscript(input.transcript_path || input.transcriptPath || '');
  let sourceTranscript = transcriptPath;
  if (agentTag === 'codex') {
    sourceTranscript = transcriptPath && existsSync(transcriptPath) ? transcriptPath : findCodexRollout(id);
    transcriptPath = sourceTranscript ? normalizeCodexRollout(sourceTranscript, stateKey) : null;
  }
  const event = input.hook_event_name || input.hookEventName || 'Stop';
  const isFinal = event === 'SessionEnd' || IS_BACKFILL;
  const dateStr = dateString();
  const timeStr = timeString();
  const sessionsDir = join(VAULT, agentTag, 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(join(VAULT, 'dailies'), { recursive: true });

  const hasTranscript = Boolean(transcriptPath && existsSync(transcriptPath));
  const signals = hasTranscript ? analyzeSignals(transcriptPath) : { userMessageCount: 0, fileEditCount: 0, durationMs: null, isSaverMode: false };
  const exchanges = hasTranscript ? extractRawExchanges(transcriptPath) : [];
  let sessionPath = input.vault_session_path || findSessionNote(sessionsDir, idShort);

  // 1. Dump garantido: toda sessão deixa nota + linha no Daily, mesmo sem transcript.
  if (!sessionPath && !IS_BACKFILL) {
    sessionPath = join(sessionsDir, `Session-${dateStr}_${timeStr}-${agentFileTag}-${idShort}.md`);
    writeFileSync(sessionPath, buildSessionFile({
      agentLabel, agentTag, idShort, id, dateStr, timeStr, cwd, exchanges,
      localMeta: hasTranscript ? extractLocalMetadata(transcriptPath, cwd) : {}, isSaverMode: signals.isSaverMode,
    }));
  }
  if (!sessionPath) return allow();
  const sessionFileName = basename(sessionPath);
  const noteDate = (sessionFileName.match(/Session-(\d{4}-\d{2}-\d{2})/) || [])[1] || dateStr;
  const linkTarget = sessionFileName.replace(/\.md$/, '');
  const todayDaily = join(VAULT, 'dailies', `Daily-${dateStr}.md`);
  if (!IS_BACKFILL && !grepContains(todayDaily, idShort)) {
    const first = exchanges.find((e) => e.role === 'user');
    const pedido = first ? excerpt(first.text, 140) : 'Sessão sem prompts substantivos';
    const overnight = noteDate !== dateStr ? ' _(Overnight / Madrugada)_' : '';
    appendDailyEntry(todayDaily, dateStr, agentTag,
      `### [[${agentTag}/sessions/${linkTarget}|Sessão ${agentLabel} ${idShort}]] (${timeStr})${overnight}\n- **Pedido:** ${pedido}`);
  }
  if (!hasTranscript) return allow();

  // 2. Narrativa: sessão substancial (o backfill força), com intervalo mínimo entre gerações.
  const chain = resolveChain(IS_BACKFILL ? 'backfill' : 'narrative', CFG);
  if (chain.length === 0 || (!IS_BACKFILL && !isSubstantialSession(signals)) || signals.userMessageCount === 0) {
    if (isFinal) refreshDumpBlock(sessionPath, transcriptPath, cwd);
    return allow();
  }
  const state = readState(stateKey);
  const grown = statSync(transcriptPath).size > (state.lastSize || 0);
  const due = IS_BACKFILL || (grown && (isFinal || Date.now() - (state.lastGenAt || 0) >= REGEN_INTERVAL_MS));
  if (!due) return allow();

  // O hook nunca gera em linha (o modelo leva minutos): delega pro worker.
  if (!IS_WORKER) {
    if (isFinal && existsSync(join(os.tmpdir(), `muri-vault-gen-${stateKey}.lock`))) {
      writeState(stateKey, { ...state, pendingFinal: true }); // o worker em andamento refaz no fim
      return allow();
    }
    refreshDumpBlock(sessionPath, transcriptPath, cwd);
    spawnSummaryWorker({ ...input, transcript_path: sourceTranscript, vault_session_path: sessionPath }, stateKey);
    return allow();
  }

  // --- worker (ou backfill) ---
  for (let pass = 0; pass < 2; pass++) {
    const startSize = statSync(transcriptPath).size;
    const st = readState(stateKey);
    const { summary, model, rateLimited } = await generateSummary(
      extractTranscriptExcerpt(transcriptPath), agentLabel, listKnownProjects(), st.items || [],
    );
    if (!summary) {
      if (IS_BACKFILL) process.exitCode = rateLimited ? EXIT_RATE_LIMITED : 3;
      return allow();
    }
    const when = `${dateString()} ${timeString()}`;
    refreshDumpBlock(sessionPath, transcriptPath, cwd);
    const block = buildNarrativeBlock(summary, model, when);
    const content = insertNarrative(readFileSync(sessionPath, 'utf8'), block);
    const fm = { narrativa: model, narrativa_em: yamlQuote(when) };
    if (content.includes('formato: v2')) fm.title = yamlQuote(`Sessão ${agentLabel} ${idShort} — ${sanitize(summary.titulo_curto)}`);
    writeFileSync(sessionPath, upsertFrontmatter(content, fm));
    await bridgeNarrativeToAiMemory({ agentTag, agentLabel, id, idShort, noteDate, summary, block, sessionPath });
    try {
      writeFileSync(sessionPath.replace(/\.md$/, '.canvas'),
        buildSessionCanvas({ agentLabel, agentTag, idShort, dateStr: noteDate, timeStr, summary, sessionFileName }));
    } catch { /* best-effort */ }
    writeClassifiedNotes(summary, { dateStr: noteDate, idShort, agentTag, agentLabel, sessionFileName, state: st })
      .forEach((p) => updateProjectDashboard(p));

    const resumoLinha = summary.resumo_executivo[0] || summary.titulo_curto;
    const noteDaily = join(VAULT, 'dailies', `Daily-${noteDate}.md`);
    if (IS_BACKFILL && !grepContains(noteDaily, idShort)) {
      appendDailyEntry(noteDaily, noteDate, agentTag,
        `### [[${agentTag}/sessions/${linkTarget}|Sessão ${agentLabel} ${idShort}]] _(backfill)_\n- **Tema:** ${sanitize(summary.titulo_curto)}`);
    }
    upsertDailyNarrative(noteDaily, idShort, resumoLinha);
    if (noteDaily !== todayDaily) upsertDailyNarrative(todayDaily, idShort, resumoLinha);

    const pendingFinal = readState(stateKey).pendingFinal;
    writeState(stateKey, { ...st, lastGenAt: Date.now(), lastSize: startSize, model, pendingFinal: false });
    if (!pendingFinal || statSync(transcriptPath).size <= startSize) break;
  }
  return allow();
}

// allow() sai via process.exit; o lock do worker é liberado no 'exit'.
if (IS_WORKER && process.env.MURI_VAULT_LOCK) {
  process.on('exit', () => { try { unlinkSync(process.env.MURI_VAULT_LOCK); } catch { /* já liberado */ } });
}

main().catch((err) => {
  process.stderr.write(`muri-saver: falha ao gravar no vault (${err?.code || 'ERRO'}); rode muri-saver doctor (ou node bin/doctor.mjs).\n`);
  allow();
});
