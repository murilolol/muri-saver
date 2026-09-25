#!/usr/bin/env node
// Hook Stop (Claude Code) / Stop (Antigravity, via plugin hooks.json).
// Garante que TODA sessão termine registrada no Obsidian Vault (dailies/ +
// claude/sessions/ ou antigravity/sessions/) de forma 100% automática — sem
// depender do agente escrever manualmente. Gera a narrativa via `claude -p`
// (headless), mas o Markdown/frontmatter/mermaid é sempre montado por este
// script (nunca texto cru da LLM), respeitando a blindagem anti-quebra de
// sintaxe do CLAUDE.md/GEMINI.md (seção 10).
//
// Achado 2026-09-04: a gravação dependia de regra escrita sem enforcement,
// ficou dias sem atualizar. Depois: 1ª versão só bloqueava e pedia pro agente
// escrever (fallback ainda existe abaixo). Esta versão gera sozinho.
// Ver decisions/obsidian-vault-check-hook.md e decisions/obsidian-auto-generate.md no ai-memory.

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Self-contained on purpose (this file is copied alone into ~/.claude/hooks):
// reads the muri-saver.json written by bin/install.mjs, which sits one level
// above the hooks folder, so a vault/timezone chosen at install time is
// honored here too.
function loadMuriSaverConfig() {
  const candidates = [
    process.env.MURI_SAVER_CONFIG,
    join(dirname(dirname(fileURLToPath(import.meta.url))), 'muri-saver.json'),
    join(os.homedir(), '.claude', 'muri-saver.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      // try the next candidate
    }
  }
  return {};
}

function validTimezone(tz) {
  try {
    return Boolean(tz) && Boolean(new Intl.DateTimeFormat('en-US', { timeZone: tz }));
  } catch {
    return false;
  }
}

const MURI_CONFIG = loadMuriSaverConfig();
const VAULT = process.env.OBSIDIAN_VAULT || MURI_CONFIG.vault || join(os.homedir(), 'Documents', 'Obsidian Vault');
const TIMEZONE = [process.env.MURI_SAVER_TZ, MURI_CONFIG.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone]
  .find(validTimezone) || 'UTC';
const NOW = process.env.MURI_SAVER_NOW && !Number.isNaN(Date.parse(process.env.MURI_SAVER_NOW))
  ? new Date(process.env.MURI_SAVER_NOW)
  : new Date();
const MAX_TRANSCRIPT_CHARS = 45000; // orçamento de contexto pra chamada claude -p (~10k tokens)
const GEN_TIMEOUT_MS = 8000; // teto rigoroso de 8s (evita travar o /exit se a API externa oscilar ou der ETIMEDOUT)
const GENERATE_SUMMARY_ERROR_LOG = join(os.homedir(), '.claude', 'hooks', '.generate-summary-error.log');
const RATE_LIMIT_CACHE_FILE = join(os.homedir(), '.claude', 'hooks', '.claude-rate-limited.json');

function isClaudeRateLimited() {
  try {
    if (!existsSync(RATE_LIMIT_CACHE_FILE)) return false;
    const data = JSON.parse(readFileSync(RATE_LIMIT_CACHE_FILE, 'utf8'));
    if (data.expiresAt && Date.now() < data.expiresAt) {
      return true;
    }
  } catch {}
  return false;
}

function setClaudeRateLimited(reason, durationMs = 15 * 60 * 1000) {
  try {
    writeFileSync(RATE_LIMIT_CACHE_FILE, JSON.stringify({
      limitedAt: new Date().toISOString(),
      expiresAt: Date.now() + durationMs,
      reason: String(reason).slice(0, 300),
    }), 'utf8');
  } catch {}
}

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

function brDateString(d = NOW) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(d);
}

function brTimeString(d = NOW) {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return fmt.format(d).replace(':', 'h');
}

function fileGlobExists(dirPath, idFragment) {
  try {
    return readdirSync(dirPath).some((f) => f.includes(idFragment));
  } catch {
    return false;
  }
}

function grepContains(path, needle) {
  try {
    return readFileSync(path, 'utf8').includes(needle);
  } catch {
    return false;
  }
}

function allow(extra) {
  process.stdout.write(JSON.stringify(extra || {}));
  process.exit(0);
}

// Extrai um resumo textual estruturado da transcrição (tolera formatos
// Claude Code e Antigravity) capturando mensagens, ferramentas usadas e arquivos.
function extractTranscriptExcerpt(transcriptPath) {
  let raw;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return '';
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const parts = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const role = obj.type || obj.role || '';
      let text = '';
      const content = obj.message?.content ?? obj.content;
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .map((c) => {
            if (c?.type === 'text') return c.text;
            if (c?.type === 'tool_use') {
              const name = c.name || '';
              const input = c.input || {};
              const target = input.TargetFile || input.path || input.file_path || input.command || input.CommandLine || input.query || '';
              return `[Ação/Tool: ${name}${target ? ` -> ${String(target).slice(0, 150)}` : ''}]`;
            }
            if (c?.type === 'tool_result' && c.is_error) {
              return `[Erro na ferramenta]`;
            }
            return '';
          })
          .filter(Boolean)
          .join(' ');
      }

      // Suporte para Antigravity (tool_calls)
      if (obj.tool_calls && Array.isArray(obj.tool_calls)) {
        const calls = obj.tool_calls.map((tc) => {
          const name = tc.name || '';
          const args = tc.args || {};
          const target = args.TargetFile || args.path || args.CommandLine || args.query || '';
          return `[Ação/Tool: ${name}${target ? ` -> ${String(target).slice(0, 150)}` : ''}]`;
        }).join(' ');
        if (calls) text = text ? `${text} ${calls}` : calls;
      }

      if (text) {
        if (text.includes('<local-command-caveat>')) continue;
        parts.push(`${role}: ${text}`);
      }
    } catch {
      // ignora linhas não JSON
    }
  }
  let excerpt = parts.join('\n');
  if (excerpt.length > MAX_TRANSCRIPT_CHARS) {
    // Mantém primeiros 25% (objetivo/pedido inicial) + últimos 75% (desenvolvimento/conclusão)
    const headLen = Math.floor(MAX_TRANSCRIPT_CHARS * 0.25);
    const tailLen = MAX_TRANSCRIPT_CHARS - headLen;
    excerpt = excerpt.slice(0, headLen) + '\n\n[... trecho intermediário omitido ...]\n\n' + excerpt.slice(-tailLen);
  }
  return excerpt || raw.slice(-MAX_TRANSCRIPT_CHARS);
}

// Extração puramente local (sem LLM, sem rede) de metadados ricos pros dumps
// automáticos: arquivos tocados (transcript + `git`), contagem de comandos
// executados e status de tasks. Roda só nos caminhos de dump local (muri-saver/
// trivial/fallback) — a narrativa via LLM já tem contexto rico o suficiente.
// Timeout curto no `git` (best-effort, nunca lança) garante que uma falha de
// rede/hooks do git ou repo ausente não trave o `/exit`.
function extractLocalMetadata(transcriptPath, cwd) {
  const filesTouched = new Set();
  let commandCount = 0;
  const taskStatuses = new Map();

  try {
    const raw = readFileSync(transcriptPath, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const content = obj.message?.content ?? obj.content;
      const calls = Array.isArray(content) ? content.filter((c) => c?.type === 'tool_use') : [];
      if (Array.isArray(obj.tool_calls)) {
        for (const tc of obj.tool_calls) calls.push({ name: tc.name, input: tc.args || {} });
      }
      for (const c of calls) {
        commandCount++;
        const input = c.input || {};
        const path = input.file_path || input.TargetFile || input.path;
        if (path && (FILE_EDIT_TOOLS_CLAUDE.has(c.name) || FILE_EDIT_TOOL_PATTERN_AGY.test(c.name || ''))) {
          filesTouched.add(String(path));
        }
        const taskId = input.taskId || input.id;
        if (c.name === 'TaskUpdate' && input.status) taskStatuses.set(taskId || String(taskStatuses.size), input.status);
        else if (c.name === 'TaskCreate' && !taskStatuses.has(taskId)) taskStatuses.set(taskId || String(taskStatuses.size), 'pending');
      }
    }
  } catch {
    // transcrição ilegível — segue só com o que o git der
  }

  try {
    // --porcelain sozinho já cobre modificados (tracked) e novos (untracked);
    // não precisa de um `git diff` separado (economiza um segundo spawn).
    const out = execFileSync('git', ['-C', cwd, 'status', '--porcelain'], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] });
    out.split('\n').filter(Boolean).forEach((l) => filesTouched.add(l.slice(3).trim()));
  } catch {
    // não é repo git ou git ausente — ignora
  }

  const taskValues = [...taskStatuses.values()];
  const tasksDone = taskValues.filter((s) => /complet|done|conclu/i.test(s)).length;

  return {
    filesTouched: [...filesTouched].slice(0, 30),
    commandCount,
    taskSummary: taskValues.length ? `${tasksDone}/${taskValues.length} tasks concluídas` : null,
  };
}

// --- Filtro de trivialidade -------------------------------------------------
// Roda ANTES de generateSummary(). Decide dump bruto (grátis, sem LLM) vs
// narrativa via IA (cara, ~10-13k tokens da cota do plano 5h/7d, não é
// billing de API separado). Passada própria e independente da transcrição —
// não reaproveita extractTranscriptExcerpt(), pra não arriscar regressão no
// caminho que já funciona hoje.
// Achado 2026-09-12: o hook antigo chamava `claude -p` em TODA sessão, sem
// filtro nenhum — só pulava se a sessão já tivesse sido registrada antes.

const FILE_EDIT_TOOLS_CLAUDE = new Set(['Edit', 'Write', 'NotebookEdit']);
// Antigravity: nome de tool não verificado contra amostra real (não localizada
// na investigação de 2026-09-12 — Cascade não parece persistir transcript
// local acessível). Regex heurístico, errando pro lado de "conta como edição"
// (pior caso: chama a LLM uma vez a mais, nunca o oposto de silenciar sessão
// real). O log de diagnóstico abaixo existe pra validar/recalibrar isso com
// dado real depois de 1-2 semanas — depois remover o log.
const FILE_EDIT_TOOL_PATTERN_AGY = /write|edit|replace.*file|create.*file|notebook/i;

const MIN_SUBSTANTIAL_USER_MESSAGES = 2;
const MIN_SUBSTANTIAL_DURATION_MS = 2 * 60 * 1000; // 2 min
const TRIVIAL_DEBUG_LOG = join(os.homedir(), '.claude', 'hooks', '.trivial-filter-debug.log');

function isRealUserPromptText(text) {
  if (!text) return false;
  const t = String(text).trim();
  if (!t) return false;
  if (t.startsWith('<command-name>')) return false; // /clear, /model, /compact...
  if (t.startsWith('<local-command-stdout>')) return false;
  if (t.includes('<local-command-caveat>')) return false;
  return true;
}

function analyzeTrivialitySignals(transcriptPath, isAntigravity) {
  let raw;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return { userMessageCount: 0, fileEditCount: 0, durationMs: null };
  }

  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  let userMessageCount = 0;
  let fileEditCount = 0;
  let firstTs = null;
  let lastTs = null;

  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = obj.timestamp || obj.created_at;
    if (ts) {
      const t = Date.parse(ts);
      if (!Number.isNaN(t)) {
        if (firstTs === null || t < firstTs) firstTs = t;
        if (lastTs === null || t > lastTs) lastTs = t;
      }
    }

    const role = obj.type || obj.role || '';
    const content = obj.message?.content ?? obj.content;

    if ((role === 'user' || role === 'USER_INPUT') && !obj.isMeta) {
      if (typeof content === 'string' && isRealUserPromptText(content)) {
        userMessageCount++;
      } else if (
        Array.isArray(content) &&
        content.some((c) => c?.type === 'text' && isRealUserPromptText(c.text))
      ) {
        userMessageCount++;
      }
    }

    if (Array.isArray(content)) {
      for (const c of content) {
        if (c?.type === 'tool_use' && FILE_EDIT_TOOLS_CLAUDE.has(c.name)) fileEditCount++;
      }
    }
    if (Array.isArray(obj.tool_calls)) {
      for (const tc of obj.tool_calls) {
        if (tc?.name && FILE_EDIT_TOOL_PATTERN_AGY.test(tc.name)) fileEditCount++;
      }
    }
  }

  // [\s-]? (não só -?) porque "muri saver" com espaço é a forma de gatilho mais
  // comum (achado 2026-09-23: regex antigo só pegava "muri-saver"/"murisaver",
  // deixando sessões ativadas por texto puro caírem no caminho caro via LLM).
  const isMuriSaver = /muri[\s-]?saver/i.test(raw) || process.env.MURI_SAVER === '1';

  const signals = {
    userMessageCount,
    fileEditCount,
    durationMs: firstTs !== null && lastTs !== null ? lastTs - firstTs : null,
    isMuriSaver,
  };

  if (isAntigravity) {
    try {
      appendFileSync(TRIVIAL_DEBUG_LOG, `${new Date().toISOString()} ${JSON.stringify(signals)}\n`);
    } catch {
      // best-effort — diagnóstico nunca deve travar o hook
    }
  }

  return signals;
}

function isSubstantialSession(signals) {
  const editHappened = signals.fileEditCount > 0;
  const enoughMessages = signals.userMessageCount >= MIN_SUBSTANTIAL_USER_MESSAGES;
  const longEnough =
    signals.durationMs === null ? true : signals.durationMs >= MIN_SUBSTANTIAL_DURATION_MS;
  return editHappened && enoughMessages && longEnough;
}

const MAX_RAW_DUMP_CHARS = 60000;

function extractRawExchanges(transcriptPath) {
  let raw;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const exchanges = [];

  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const role = obj.type || obj.role || '';
    const content = obj.message?.content ?? obj.content;
    const isUser = (role === 'user' || role === 'USER_INPUT') && !obj.isMeta;
    const isAssistant = role === 'assistant' || role === 'PLANNER_RESPONSE' || role === 'model';

    if (isUser) {
      let text = null;
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        const t = content.find((c) => c?.type === 'text');
        if (t) text = t.text;
      }
      if (isRealUserPromptText(text)) exchanges.push({ role: 'user', text: text.trim() });
    } else if (isAssistant) {
      if (typeof content === 'string' && content.trim()) {
        exchanges.push({ role: 'assistant', text: content.trim() });
      } else if (Array.isArray(content)) {
        const textParts = content
          .filter((c) => c?.type === 'text')
          .map((c) => c.text)
          .filter(Boolean);
        if (textParts.length) exchanges.push({ role: 'assistant', text: textParts.join('\n\n').trim() });
      }
    }
  }
  return exchanges;
}

function buildRawDumpBody(exchanges) {
  if (exchanges.length === 0) {
    return '_Nenhum prompt substantivo capturado nesta sessão (provavelmente só comandos rápidos)._';
  }
  let body = exchanges
    .map((e) => `${e.role === 'user' ? '🧑 **Usuário**' : '🤖 **IA**'}\n\n${sanitize(e.text)}`)
    .join('\n\n---\n\n');
  if (body.length > MAX_RAW_DUMP_CHARS) {
    const headLen = Math.floor(MAX_RAW_DUMP_CHARS * 0.5);
    body =
      body.slice(0, headLen) +
      '\n\n[... trecho intermediário omitido ...]\n\n' +
      body.slice(-(MAX_RAW_DUMP_CHARS - headLen));
  }
  return body;
}

function buildRawDumpSessionFile({ agentLabel, agentTag, idShort, id, dateStr, timeStr, exchanges, reason = 'trivial', filesTouched = [], commandCount = 0, taskSummary = null }) {
  const firstUserPrompt = exchanges.find((e) => e.role === 'user');
  const titulo = excerptText(firstUserPrompt ? firstUserPrompt.text : 'Sessão sem prompts registrados', 80);
  const icon = agentTag === 'claude' ? '🟧' : '🤖';

  const metaLines = [`- **Comandos/ações executados:** ${commandCount}`];
  if (taskSummary) metaLines.push(`- **Tasks:** ${taskSummary}`);
  metaLines.push(
    filesTouched.length
      ? `- **Arquivos tocados (${filesTouched.length}):** ${filesTouched.map((f) => `\`${f}\``).join(', ')}`
      : '- **Arquivos tocados:** nenhum detectado',
  );
  const metaBlock = `\n## 📊 Metadados Locais (extração sem LLM)\n\n${metaLines.join('\n')}\n`;

  let reasonDesc = '- **Sessão trivial** — não cruzou o limiar de substancialidade, gerado sem custo de LLM.';
  if (reason === 'muri-saver') {
    reasonDesc = '- **Modo Muri-Saver** — encerramento instantâneo (<10ms) e economia agressiva de tokens (sem chamada de LLM externa).';
  } else if (reason === 'rate-limit') {
    reasonDesc = '- **LLM externa em cota/limite** — gravado localmente de forma instantânea sem perda de histórico.';
  } else if (reason === 'fallback' || reason === 'timeout') {
    reasonDesc = '- **Salvamento local instantâneo** — gerado diretamente a partir da transcrição local.';
  }

  return `---
title: ${yamlQuote(`Sessão ${agentLabel} ${idShort} (dump local) — ${titulo}`)}
agent: ${agentTag}
date_start: ${dateStr}
session_id: ${idShort}
tier: episodic
status: concluded
generated: auto-raw-dump
tags:
  - session
  - ${agentTag}
  - muri-saver
  - raw-dump
---

# ${icon} Sessão ${agentLabel} ${idShort} (dump local)

🏷️ **Tags:** #session #${agentTag} #muri-saver #raw-dump

- **ID da Sessão:** \`${idShort}\` (\`${id}\`)
- **Agente:** ${agentLabel}
- **Data:** ${dateStr} às ${timeStr}
${reasonDesc}

---
${metaBlock}
---

## 💬 Prompts & Respostas (dump local)

${buildRawDumpBody(exchanges)}

---

## 🌐 Conexões Globais no Grafo
[[${agentTag}/README|Central ${agentLabel}]] [[dailies/Daily-${dateStr}|Diário de Bordo ${dateStr}]]
`;
}

// Mesma sanitização de lib/sanitize.mjs (copiada porque este hook roda
// sozinho em ~/.claude/hooks): mascara segredos, remove tags de sistema e
// escapa HTML solto (blindagem anti-quebra de Markdown/Obsidian).
const SECRET_PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{10,}/g, 'ANTHROPIC_KEY'],
  [/sk-proj-[A-Za-z0-9_-]{10,}/g, 'OPENAI_PROJECT_KEY'],
  [/\bsk-[A-Za-z0-9]{20,}\b/g, 'API_KEY'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, 'GITHUB_TOKEN'],
  [/github_pat_[A-Za-z0-9_]{20,}/g, 'GITHUB_TOKEN'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, 'SLACK_TOKEN'],
  [/AKIA[0-9A-Z]{16}/g, 'AWS_ACCESS_KEY_ID'],
  [/(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/g, 'AWS_SECRET_ACCESS_KEY'],
  [/AIza[0-9A-Za-z_-]{35}/g, 'GOOGLE_API_KEY'],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'JWT'],
  [/Bearer\s+[A-Za-z0-9._-]{20,}/g, 'BEARER_TOKEN'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, 'PRIVATE_KEY'],
  [/(?:senha|password|passwd)\s*[:=]\s*['"]?\S{6,}['"]?/gi, 'PASSWORD'],
];
const DROP_BLOCKS_RE = /<(ADDITIONAL_METADATA|SYSTEM_MESSAGE|system-reminder|local-command-caveat|CONTEXT_SUMMARY)>[\s\S]*?<\/\1>/g;
const SYSTEM_TAGS_RE = /<\/?(?:USER_REQUEST|ADDITIONAL_METADATA|CONTEXT_SUMMARY|SYSTEM_MESSAGE|PLAN|local-command-caveat|local-command-stdout|command-name|command-message|command-args|system-reminder)>/g;

function cleanText(text) {
  let out = String(text || '');
  for (const [re, label] of SECRET_PATTERNS) out = out.replace(re, `[REDACTED:${label}]`);
  return out.replace(DROP_BLOCKS_RE, '').replace(SYSTEM_TAGS_RE, '');
}

// Titles come from the user's first prompt; unquoted, a ": " would break the
// note's YAML frontmatter.
function yamlQuote(text) {
  return `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
}

function escapeHtml(text) {
  return String(text).replace(/<\/?[a-zA-Z][^>]*>/g, (m) => '`' + m + '`');
}

function sanitize(text) {
  if (!text) return '';
  return escapeHtml(cleanText(text));
}

// Limpa antes de cortar: cortar texto cru pode partir um segredo ou uma tag
// ao meio, e a metade não casa mais com os padrões que os removem.
function excerptText(text, max) {
  const cleaned = cleanText(text).replace(/\s+/g, ' ').trim();
  const cut = cleaned.length > max ? `${cleaned.slice(0, max - 1).replace(/<[^>]*$/, '').trimEnd()}…` : cleaned;
  return escapeHtml(cut);
}

// No Windows, spawnSync/execFileSync não consegue rodar `claude.cmd` diretamente
// sem shell:true (erro EINVAL — limitação do Node, não do Claude Code), e usar
// shell:true arrisca quebrar o prompt multi-linha na hora do parsing do cmd.exe.
// Solução: resolver o .exe real por trás do shim npm e chamar ele direto.
let cachedClaudeBin = null;
function resolveClaudeBin() {
  if (cachedClaudeBin) return cachedClaudeBin;
  if (process.platform !== 'win32') {
    const localBin = join(os.homedir(), '.local', 'bin', 'claude');
    if (existsSync(localBin)) return (cachedClaudeBin = localBin);
    return (cachedClaudeBin = 'claude');
  }
  const candidates = [
    join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
  ];
  try {
    const shimDir = execFileSync('where', ['claude.cmd'], { encoding: 'utf8' }).trim().split('\n')[0];
    if (shimDir) {
      const dir = shimDir.replace(/[\\/]claude\.cmd$/i, '');
      candidates.unshift(join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
    }
  } catch {
    // `where` falhou -> segue só com o candidato fixo
  }
  cachedClaudeBin = candidates.find((p) => existsSync(p)) || candidates[candidates.length - 1];
  return cachedClaudeBin;
}

// Categorias válidas pra classificação por projeto (Fase 3 da reestruturação
// 2026-09-07; expandido pra 12 categorias no /grill-me do mesmo dia). Chave
// ASCII que a LLM devolve == nome real da pasta (tudo ASCII, sem acento, por
// decisão explícita — evita problema de encoding em git/terminal/URL).
const CATEGORY_DIRS = {
  bug: 'bugs',
  pedido: 'pedidos',
  melhoria: 'melhorias',
  correcao: 'correcoes',
  prompt: 'prompts',
  duvida: 'duvidas',
  ideia: 'ideias',
  decisao: 'decisoes',
  'divida-tecnica': 'divida-tecnica',
  pesquisa: 'pesquisa',
  release: 'releases',
  risco: 'riscos',
};
const CATEGORY_EMOJI = {
  bug: '🐛', pedido: '📩', melhoria: '✨', correcao: '🔧', prompt: '💬',
  duvida: '❓', ideia: '💡', decisao: '🧭', 'divida-tecnica': '🩹',
  pesquisa: '🔍', release: '🚀', risco: '⚠️',
};
// Categorias "acionáveis" (têm ciclo de vida) ganham status; um subconjunto
// delas também ganha prioridade. Decidido explicitamente no /grill-me — as
// demais (decisao/prompt/pesquisa/release/ideia/duvida/correcao) são registro,
// não tarefa em aberto.
const STATUS_CATEGORIES = new Set(['bug', 'pedido', 'melhoria', 'risco', 'divida-tecnica']);
const PRIORITY_CATEGORIES = new Set(['bug', 'risco', 'divida-tecnica']);
const VALID_ORIGENS = new Set(['usuario', 'ia', 'sistema']);

function listKnownProjects() {
  try {
    return readdirSync(join(VAULT, 'projects'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function slugify(text) {
  return String(text)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40)
    .replace(/-+$/, '') || 'item';
}

function generateSummary(transcriptExcerpt, agentLabel, knownProjects) {
  if (!transcriptExcerpt) return null;
  if (isClaudeRateLimited()) return null; // Fast-fail imediato: 0ms de espera se já em cota/limite
  const prompt = [
    'Você recebe a transcrição de uma sessão real de um agente de codificação (Claude Code ou Antigravity).',
    'Seu papel é gerar uma documentação RICA, TÉCNICA E DETALHADA para o Obsidian Vault do desenvolvedor.',
    'Responda APENAS com um objeto JSON válido (sem texto antes/depois, sem markdown wrapper):',
    '{',
    '  "titulo_curto": "5 a 12 palavras objetivas resumindo o feito da sessão",',
    '  "resumo_executivo": ["1 a 3 parágrafos claros explicando o contexto, pedido do usuário e o desfecho"],',
    '  "decisoes": ["Decisão técnica ou arquitetural 1", "Decisão 2..."],',
    '  "acoes_realizadas": ["Ação concreta executada 1 (ex: criação do script X)", "Ação 2..."],',
    '  "orientacoes_e_respostas_ia": ["Orientação, explicação técnica ou resposta chave dada pela IA"],',
    '  "entregaveis_e_arquivos": ["caminho/do/arquivo1", "caminho/do/arquivo2"],',
    '  "tags_extra": ["tag1", "tag2", "tag3"],',
    '  "itens_categorizados": [{"categoria":"bug|pedido|melhoria|correcao|prompt|duvida|ideia|decisao|divida-tecnica|pesquisa|release|risco","projeto":"slug-exato-da-lista","titulo":"5 a 12 palavras","texto":"1-3 frases","origem":"usuario|ia|sistema","status":"aberto|em-andamento|feito","prioridade":"baixa|media|alta|critica"}]',
    '}',
    'Regras:',
    '- decisoes: capture decisões REAIS tomadas na sessão (arquitetura, configs, regras de negócio, bibliotecas escolhidas, formatos). Se nenhuma decisão relevante, lista vazia [].',
    '- acoes_realizadas: seja específico com nomes de scripts, comandos rodados, testes validados, correções de código.',
    '- orientacoes_e_respostas_ia: o que a IA respondeu, explicou ou orientou de valioso para o usuário (conhecimento útil para consulta futura).',
    '- entregaveis_e_arquivos: liste arquivos, scripts e artefatos criados ou alterados na sessão.',
    '- tags_extra: 3 a 5 tags curtas em kebab-case.',
    `Projetos conhecidos (use EXATAMENTE um destes slugs em "projeto", nunca invente um novo): ${knownProjects.join(', ') || '(nenhum projeto conhecido)'}`,
    'itens_categorizados: no máximo 8 itens. Só inclua um item se a sessão claramente tocou um desses projetos E o conteúdo for categorizável de verdade.',
    '',
    `--- TRECHO DA TRANSCRIÇÃO (agente: ${agentLabel}) ---`,
    transcriptExcerpt,
  ].join('\n');

  try {
    const claudeBin = resolveClaudeBin();
    const out = execFileSync(claudeBin, [
      '-p', prompt,
      '--model', 'claude-haiku-4-5-20251001',
      '--output-format', 'text',
      '--permission-prompts', 'none',
      '--no-session-persistence',
      '--max-budget-usd', '0.20',
    ], {
      encoding: 'utf8',
      timeout: GEN_TIMEOUT_MS,
      env: { ...process.env, MURI_SAVER_OBSIDIAN_GEN: '1' },
    });
    const match = out.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!parsed.titulo_curto) return null;

    // Normaliza resumo executivo (retrocompatibilidade com resumo_paragrafos)
    if (!Array.isArray(parsed.resumo_executivo) && Array.isArray(parsed.resumo_paragrafos)) {
      parsed.resumo_executivo = parsed.resumo_paragrafos;
    }
    if (!Array.isArray(parsed.resumo_executivo)) {
      parsed.resumo_executivo = [parsed.titulo_curto];
    }

    parsed.decisoes = Array.isArray(parsed.decisoes) ? parsed.decisoes.slice(0, 8) : [];
    parsed.acoes_realizadas = Array.isArray(parsed.acoes_realizadas) ? parsed.acoes_realizadas.slice(0, 10) : [];
    parsed.orientacoes_e_respostas_ia = Array.isArray(parsed.orientacoes_e_respostas_ia) ? parsed.orientacoes_e_respostas_ia.slice(0, 8) : [];
    parsed.entregaveis_e_arquivos = Array.isArray(parsed.entregaveis_e_arquivos) ? parsed.entregaveis_e_arquivos.slice(0, 12) : [];

    const knownSet = new Set(knownProjects);
    parsed.itens_categorizados = (Array.isArray(parsed.itens_categorizados) ? parsed.itens_categorizados : [])
      .filter((it) => it && CATEGORY_DIRS[it.categoria] && knownSet.has(it.projeto) && it.titulo)
      .map((it) => ({
        ...it,
        origem: VALID_ORIGENS.has(it.origem) ? it.origem : 'ia',
        status: STATUS_CATEGORIES.has(it.categoria) ? (it.status || 'aberto') : '',
        prioridade: PRIORITY_CATEGORIES.has(it.categoria) ? (it.prioridade || 'media') : '',
      }))
      .slice(0, 8);
    return parsed;
  } catch (err) {
    try {
      const msg = err?.stderr?.toString?.() || err?.stdout?.toString?.() || err?.message || String(err);
      appendFileSync(GENERATE_SUMMARY_ERROR_LOG, `${new Date().toISOString()} ${msg.slice(0, 500)}\n`);
      if (/limit|quota|unauthorized|blocked|ETIMEDOUT/i.test(msg)) {
        setClaudeRateLimited(msg, 15 * 60 * 1000);
      }
    } catch {
      // best-effort — nunca deve travar o hook por causa do log de diagnóstico
    }
    return null;
  }
}

// Fase 3 (2026-09-07, expandido no /grill-me do mesmo dia): grava notas
// atômicas por categoria dentro de projects/<projeto>/<categoria>/, linkadas
// de volta pra sessão-fonte. Aditivo só — nunca roda se a sessão já tiver
// sido registrada antes (gate em main()). Retorna o conjunto de projetos
// tocados, pra updateProjectDashboard() saber quais README recalcular.
function writeClassifiedNotes(summary, { dateStr, idShort, agentTag, agentLabel, sessionFileName }) {
  const items = summary.itens_categorizados || [];
  const sessionLink = `${agentTag}/sessions/${sessionFileName.replace(/\.md$/, '')}`;
  const touchedProjects = new Set();
  items.forEach((item, i) => {
    const dir = join(VAULT, 'projects', item.projeto, CATEGORY_DIRS[item.categoria]);
    try {
      mkdirSync(dir, { recursive: true });
      const slug = slugify(item.titulo);
      const fileName = `${item.categoria}-${dateStr}-${idShort}-${String(i + 1).padStart(2, '0')}-${slug}.md`;
      const filePath = join(dir, fileName);
      if (existsSync(filePath)) return;
      const titulo = sanitize(item.titulo);
      const texto = sanitize(item.texto || '');
      const emoji = CATEGORY_EMOJI[item.categoria] || '📝';
      const statusLine = item.status ? `status: ${item.status}\n` : '';
      const prioridadeLine = item.prioridade ? `prioridade: ${item.prioridade}\n` : '';
      const metaLine = [
        item.status ? `**Status:** ${item.status}` : null,
        item.prioridade ? `**Prioridade:** ${item.prioridade}` : null,
      ].filter(Boolean).join(' · ');
      writeFileSync(filePath, `---
title: ${yamlQuote(titulo)}
projeto: ${item.projeto}
categoria: ${item.categoria}
origem: ${item.origem}
${statusLine}${prioridadeLine}origem_sessao: "[[${sessionLink}]]"
date: ${dateStr}
generated: auto
tags:
  - ${item.categoria}
  - ${item.projeto}
---

# ${emoji} ${titulo}

🏷️ **Tags:** #${item.categoria} #${item.projeto}

- **Projeto:** [[projects/${item.projeto}/README|${item.projeto}]]
${metaLine ? `- ${metaLine}\n` : ''}- **Origem:** ${item.origem}
- **Sessão de origem:** [[${sessionLink}|Sessão ${agentLabel} ${idShort}]]
- **Data:** ${dateStr}

${texto}
`);
      touchedProjects.add(item.projeto);
    } catch {
      // best-effort — nunca deve travar o hook nem bloquear a sessão por causa disso
    }
  });
  return touchedProjects;
}

// Recalcula a contagem por categoria e reescreve o bloco marcado no README.md
// do projeto (nunca mexe no resto do arquivo). Best-effort, igual ao resto.
function updateProjectDashboard(projeto) {
  try {
    const projectDir = join(VAULT, 'projects', projeto);
    const readmePath = join(projectDir, 'README.md');
    if (!existsSync(readmePath)) return;
    const rows = Object.entries(CATEGORY_DIRS).map(([key, dirName]) => {
      let count = 0;
      try {
        count = readdirSync(join(projectDir, dirName)).filter((f) => f.endsWith('.md') && f !== 'README.md').length;
      } catch {
        count = 0;
      }
      return `| ${CATEGORY_EMOJI[key] || ''} ${dirName} | ${count} |`;
    });
    const block = `<!-- CATEGORY_COUNTS -->\n| Categoria | Itens |\n|---|---|\n${rows.join('\n')}\n\n_Atualizado automaticamente pelo hook em ${brDateString()}._\n<!-- /CATEGORY_COUNTS -->`;
    const content = readFileSync(readmePath, 'utf8');
    if (content.includes('<!-- CATEGORY_COUNTS -->') && content.includes('<!-- /CATEGORY_COUNTS -->')) {
      writeFileSync(readmePath, content.replace(/<!-- CATEGORY_COUNTS -->[\s\S]*?<!-- \/CATEGORY_COUNTS -->/, block));
    } else {
      writeFileSync(readmePath, `${content.trimEnd()}\n\n## 📊 Dashboard (auto)\n${block}\n`);
    }
  } catch {
    // best-effort
  }
}

function buildSessionFile({ agentLabel, agentTag, idShort, id, dateStr, timeStr, summary }) {
  const titulo = sanitize(summary.titulo_curto);
  const resumo = (summary.resumo_executivo || summary.resumo_paragrafos || []).map(sanitize);
  const decisoes = (summary.decisoes || []).map(sanitize);
  const acoes = (summary.acoes_realizadas || []).map(sanitize);
  const orientacoes = (summary.orientacoes_e_respostas_ia || []).map(sanitize);
  const arquivos = (summary.entregaveis_e_arquivos || []).map(sanitize);

  const base = ['session', agentTag, 'muri-saver'];
  const tagsExtra = (summary.tags_extra || []).filter((t) => !base.includes(t)).slice(0, 5);
  const allTags = [...base, ...tagsExtra];
  const tagsYaml = allTags.map((t) => `  - ${t}`).join('\n');
  const tagsLine = allTags.map((t) => `#${t}`).join(' ');

  let secaoDecisoes = '';
  if (decisoes.length > 0) {
    secaoDecisoes = `\n---\n\n## 🧭 Decisões Técnicas & Arquiteturais\n\n${decisoes.map((d) => `- ${d}`).join('\n')}\n`;
  }

  let secaoAcoes = '';
  if (acoes.length > 0) {
    secaoAcoes = `\n---\n\n## ⚡ Ações Realizadas & Implementações\n\n${acoes.map((a) => `- ${a}`).join('\n')}\n`;
  }

  let secaoOrientacoes = '';
  if (orientacoes.length > 0) {
    secaoOrientacoes = `\n---\n\n## 💡 Orientações & Respostas Chave da IA\n\n${orientacoes.map((o) => `- ${o}`).join('\n')}\n`;
  }

  let secaoArquivos = '';
  if (arquivos.length > 0) {
    secaoArquivos = `\n---\n\n## 📦 Arquivos & Entregáveis\n\n${arquivos.map((f) => `- \`${f}\``).join('\n')}\n`;
  }

  const icon = agentTag === 'claude' ? '🟧' : '🤖';

  return `---
title: ${yamlQuote(`Sessão ${agentLabel} ${idShort} — ${titulo}`)}
agent: ${agentTag}
date_start: ${dateStr}
session_id: ${idShort}
tier: episodic
status: concluded
generated: auto-enriched
tags:
${tagsYaml}
---

# ${icon} Sessão ${agentLabel} ${idShort} — ${titulo}

🏷️ **Tags:** ${tagsLine}

- **ID da Sessão:** \`${idShort}\` (\`${id}\`)
- **Agente:** ${agentLabel}
- **Data:** ${dateStr} às ${timeStr}
- **Gerado automaticamente** via hook \`obsidian-vault-check.mjs\` a partir da transcrição real desta sessão.

---

## 🏗️ Diagrama da Sessão

\`\`\`mermaid
graph TD
    Ag["${icon} ${agentLabel} (${idShort})"]
    Work["⚡ Ações & Entregas"]
    Vault["📚 Obsidian & ai-memory"]
    Ag --> Work
    Work --> Vault
\`\`\`

---

## 📝 Síntese Executiva

${resumo.join('\n\n')}
${secaoDecisoes}${secaoAcoes}${secaoOrientacoes}${secaoArquivos}
---

## 🌐 Conexões Globais no Grafo
[[${agentTag}/README|Central ${agentLabel}]] [[dailies/Daily-${dateStr}|Diário de Bordo ${dateStr}]]
`;
}

function buildSessionCanvas({ agentLabel, agentTag, idShort, dateStr, timeStr, summary, sessionFileName }) {
  const titulo = sanitize(summary.titulo_curto || 'Sessão');
  const resumo = (summary.resumo_executivo || summary.resumo_paragrafos || []).slice(0, 2).map(sanitize).join('\n\n');
  const decisoes = (summary.decisoes || []).slice(0, 4).map(sanitize);
  const acoes = (summary.acoes_realizadas || []).slice(0, 4).map(sanitize);
  const items = summary.itens_categorizados || [];

  const summaryText = [
    `### 📝 Síntese Executiva\n\n${resumo}`,
    decisoes.length > 0 ? `**🧭 Decisões:**\n${decisoes.map((d) => `• ${d}`).join('\n')}` : null,
    acoes.length > 0 ? `**⚡ Ações:**\n${acoes.map((a) => `• ${a}`).join('\n')}` : null,
  ].filter(Boolean).join('\n\n');

  const nodes = [
    {
      id: 'agent-node',
      type: 'text',
      text: `## ${agentTag === 'claude' ? '🟧' : '🤖'} Sessão ${agentLabel} \`${idShort}\`\n\n**Data:** ${dateStr} às ${timeStr}\n**Tema:** ${titulo}`,
      x: -400,
      y: -100,
      width: 340,
      height: 200,
      color: agentTag === 'claude' ? '1' : '4',
    },
    {
      id: 'summary-node',
      type: 'text',
      text: summaryText,
      x: 0,
      y: -150,
      width: 480,
      height: 380,
      color: '3',
    },
    {
      id: 'session-file-node',
      type: 'file',
      file: `${agentTag}/sessions/${sessionFileName}`,
      x: 540,
      y: -200,
      width: 400,
      height: 420,
    },
  ];

  const edges = [
    {
      id: 'edge-agent-summary',
      fromNode: 'agent-node',
      fromSide: 'right',
      toNode: 'summary-node',
      toSide: 'left',
    },
    {
      id: 'edge-summary-file',
      fromNode: 'summary-node',
      fromSide: 'right',
      toNode: 'session-file-node',
      toSide: 'left',
    },
  ];

  items.slice(0, 5).forEach((item, idx) => {
    const nodeId = `cat-item-${idx}`;
    const emoji = CATEGORY_EMOJI[item.categoria] || '📌';
    nodes.push({
      id: nodeId,
      type: 'text',
      text: `#### ${emoji} ${item.categoria.toUpperCase()}: ${sanitize(item.titulo)}\n\n**Projeto:** ${item.projeto}\n${item.status ? `**Status:** ${item.status}\n` : ''}${sanitize(item.texto || '')}`,
      x: idx * 320 - 200,
      y: 260,
      width: 300,
      height: 220,
      color: '5',
    });
    edges.push({
      id: `edge-summary-${nodeId}`,
      fromNode: 'summary-node',
      fromSide: 'bottom',
      toNode: nodeId,
      toSide: 'top',
    });
  });

  return JSON.stringify({ nodes, edges }, null, 2);
}

function ensureDailySkeleton(dateStr, agentTag) {
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
  - muri-saver
---

# 📅 Diário de Bordo — ${dateStr}

Registro cronológico e síntese de todas as atividades, implementações e governança executadas no ecossistema ao longo do dia ${dateStr.split('-').reverse().join('/')}. Gerado automaticamente.

---

## 📋 Sessões do Dia

<!-- ENTRIES -->

---

## 🌐 Conexões Globais no Grafo
[[Hub-Projects|Central de Projetos]] [[Hub-Agents|Central de Agentes]]
`;
}

function appendDailyEntry(dailyPath, dateStr, agentTag, entryMarkdown) {
  if (!existsSync(dailyPath)) {
    writeFileSync(dailyPath, ensureDailySkeleton(dateStr, agentTag).replace('<!-- ENTRIES -->', `${entryMarkdown}\n<!-- ENTRIES -->`));
    return;
  }
  const content = readFileSync(dailyPath, 'utf8');
  if (content.includes('<!-- ENTRIES -->')) {
    writeFileSync(dailyPath, content.replace('<!-- ENTRIES -->', `${entryMarkdown}\n<!-- ENTRIES -->`));
    return;
  }
  // Arquivo escrito manualmente antes (sem o marcador) — insere antes da seção de conexões,
  // ou anexa no fim se a seção não existir. Nunca sobrescreve conteúdo existente.
  const marker = '## 🌐 Conexões Globais no Grafo';
  if (content.includes(marker)) {
    writeFileSync(dailyPath, content.replace(marker, `${entryMarkdown}\n\n---\n\n${marker}`));
  } else {
    appendFileSync(dailyPath, `\n\n---\n\n${entryMarkdown}\n`);
  }
}

function main() {
  // Guarda anti-recursão: se esta invocação do `claude -p` (chamada pelo próprio
  // hook) disparar seu Stop hook, aborta sem gerar nada de novo.
  if (process.env.MURI_SAVER_OBSIDIAN_GEN === '1') return allow();

  const input = readStdin();
  const isAntigravity = Boolean(input.conversationId);
  const id = input.session_id || input.conversationId || '';
  const transcriptPath = input.transcript_path || input.transcriptPath || '';
  const cwd = input.cwd || process.cwd();
  if (!id) return allow();

  const dateStr = brDateString();
  const timeStr = brTimeString();
  const idShort = id.replace(/-/g, '').slice(0, 8);
  const agentTag = isAntigravity ? 'antigravity' : 'claude';
  const agentLabel = isAntigravity ? 'Antigravity' : 'Claude';
  const agentFileTag = isAntigravity ? 'AGY' : 'Claude';

  const dailyPath = join(VAULT, 'dailies', `Daily-${dateStr}.md`);
  const sessionsDir = join(VAULT, agentTag, 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(join(VAULT, 'dailies'), { recursive: true });

  const dailyDone = grepContains(dailyPath, idShort);
  const sessionDone = fileGlobExists(sessionsDir, idShort);
  if (dailyDone && sessionDone) return allow();

  const sessionFileName = `Session-${dateStr}_${timeStr}-${agentFileTag}-${idShort}.md`;
  const sessionPath = join(sessionsDir, sessionFileName);
  const sessionLinkTarget = sessionFileName.replace(/\.md$/, ''); // wikilinks nunca levam extensão, convenção do vault

  // Filtro de trivialidade (2026-09-12): sessão sem edição de arquivo real +
  // poucas mensagens + curta duração nunca chama a LLM — vira dump bruto
  // grátis. Toda sessão sempre grava algo no vault, nunca é silenciosamente
  // pulada; a diferença é dump barato vs. narrativa cara via IA.
  const signals = analyzeTrivialitySignals(transcriptPath, isAntigravity);

  // Modo Muri-Saver: encerramento imediato (<10ms) sem gastar 13k tokens de IA
  if (signals.isMuriSaver) {
    const exchanges = extractRawExchanges(transcriptPath);
    if (!sessionDone) {
      const localMeta = extractLocalMetadata(transcriptPath, cwd);
      writeFileSync(
        sessionPath,
        buildRawDumpSessionFile({ agentLabel, agentTag, idShort, id, dateStr, timeStr, exchanges, reason: 'muri-saver', ...localMeta }),
      );
    }
    if (!dailyDone) {
      const firstUserPrompt = exchanges.find((e) => e.role === 'user');
      const resumoLinha = firstUserPrompt
        ? firstUserPrompt.text
        : 'Sessão concluída (modo muri-saver)';
      const entry = `### [[${agentTag}/sessions/${sessionLinkTarget}|Sessão ${agentLabel} ${idShort}]] (${timeStr}) 🛡️ _muri-saver_\n- **Resumo:** ${excerptText(resumoLinha, 140)} _(encerramento instantâneo local - 0 tokens de LLM)_`;
      appendDailyEntry(dailyPath, dateStr, agentTag, entry);
    }
    return allow();
  }

  if (!isSubstantialSession(signals)) {
    const exchanges = extractRawExchanges(transcriptPath);
    if (!sessionDone) {
      const localMeta = extractLocalMetadata(transcriptPath, cwd);
      writeFileSync(
        sessionPath,
        buildRawDumpSessionFile({ agentLabel, agentTag, idShort, id, dateStr, timeStr, exchanges, reason: 'trivial', ...localMeta }),
      );
    }
    if (!dailyDone) {
      const firstUserPrompt = exchanges.find((e) => e.role === 'user');
      const resumoLinha = firstUserPrompt
        ? firstUserPrompt.text
        : 'Sessão trivial sem prompts substantivos';
      const entry = `### [[${agentTag}/sessions/${sessionLinkTarget}|Sessão ${agentLabel} ${idShort}]] (${timeStr}) 🪶 _raw_\n- **Resumo:** ${excerptText(resumoLinha, 140)} _(sessão trivial — dump bruto, sem narrativa IA)_`;
      appendDailyEntry(dailyPath, dateStr, agentTag, entry);
    }
    return allow();
  }

  const transcriptExcerpt = extractTranscriptExcerpt(transcriptPath);
  const knownProjects = listKnownProjects();
  const summary = generateSummary(transcriptExcerpt, agentLabel, knownProjects);

  if (!summary) {
    // A chamada `claude -p` pode falhar por restrição de conta/organização, timeout
    // ou falta de internet (não é um caso raro — ver GENERATE_SUMMARY_ERROR_LOG).
    // Em NENHUM agente o hook aborta sem gravar: sempre grava um fallback local
    // (sem custo de LLM) extraído direto da transcrição, igual ao caminho trivial.
    const exchanges = extractRawExchanges(transcriptPath);
    const reason = isClaudeRateLimited() ? 'rate-limit' : 'fallback';
    if (!sessionDone) {
      const localMeta = extractLocalMetadata(transcriptPath, cwd);
      writeFileSync(
        sessionPath,
        buildRawDumpSessionFile({ agentLabel, agentTag, idShort, id, dateStr, timeStr, exchanges, reason, ...localMeta }),
      );
    }
    if (!dailyDone) {
      const firstUserPrompt = exchanges.find((e) => e.role === 'user');
      const resumoLinha = firstUserPrompt
        ? firstUserPrompt.text
        : 'Sessão concluída (fallback local sem LLM)';
      const label = reason === 'rate-limit' ? '⚡ _fast-local_' : '🪶 _fallback_';
      const detail = reason === 'rate-limit' ? 'fallback automático - limite de LLM ativo' : 'fallback automático - LLM externa indisponível';
      const entry = `### [[${agentTag}/sessions/${sessionLinkTarget}|Sessão ${agentLabel} ${idShort}]] (${timeStr}) ${label}\n- **Resumo:** ${excerptText(resumoLinha, 140)} _(${detail})_`;
      appendDailyEntry(dailyPath, dateStr, agentTag, entry);
    }
    return allow();
  }

  if (!sessionDone) {
    writeFileSync(sessionPath, buildSessionFile({ agentLabel, agentTag, idShort, id, dateStr, timeStr, summary }));

    // Geração automática de Obsidian Canvas (.canvas) interativo
    try {
      const canvasPath = join(sessionsDir, sessionFileName.replace(/\.md$/, '.canvas'));
      writeFileSync(canvasPath, buildSessionCanvas({ agentLabel, agentTag, idShort, dateStr, timeStr, summary, sessionFileName }));
    } catch {
      // best-effort — não bloqueia o hook se falhar
    }

    const touchedProjects = writeClassifiedNotes(summary, { dateStr, idShort, agentTag, agentLabel, sessionFileName });
    touchedProjects.forEach((p) => updateProjectDashboard(p));
  }

  if (!dailyDone) {
    const resumoLinha = (summary.resumo_executivo || summary.resumo_paragrafos || [])[0] || summary.titulo_curto;
    const entry = `### [[${agentTag}/sessions/${sessionLinkTarget}|Sessão ${agentLabel} ${idShort}]] (${timeStr})\n- **Resumo:** ${excerptText(resumoLinha, 140)}`;
    appendDailyEntry(dailyPath, dateStr, agentTag, entry);
  }

  return allow();
}

main();
