#!/usr/bin/env node
// Ingestor & exportador de sessões multi-agente do muri-saver.
//
// Varre as sessões que cada agente já gravou sozinho na máquina (Claude Code,
// Antigravity/Gemini CLI, Codex CLI — inclusive o SQLite do Codex quando o
// Node tem node:sqlite — e exports avulsos do Claude Desktop/Web) e registra
// cada uma no Obsidian Vault e/ou no ai-memory, ou exporta pra uma pasta de
// Markdown solta. Por padrão NÃO chama nenhuma LLM: uma varredura retroativa
// de milhares de sessões via `claude -p` custaria uma fortuna. `--enrich` é
// opt-in, com teto de sessões por rodada e de custo por chamada.
//
// Vault e fuso horário vêm de ~/.claude/muri-saver.json (gravado pelo
// install.mjs) quando não passados por flag. Ver docs/session-ingestor.md.

import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import os from 'node:os';
import { execTool } from '../lib/exec.mjs';
import { configPath, readConfig, resolveVault, resolveTimezone, writeConfig } from '../lib/config.mjs';
import { dateParts, toDate } from '../lib/time.mjs';
import { discoverAgent, parseDesktopFile, parseSession, projectLabelFromCwd } from '../lib/parsers.mjs';
import {
  AGENT_LABEL, buildRawSessionMarkdown, buildEnrichedSessionMarkdown, listKnownProjects, writeSessionToVault,
} from '../lib/vault.mjs';
import { enrichSession, resolveClaudeBin, DEFAULT_ENRICH_MODEL, DEFAULT_MAX_BUDGET_USD } from '../lib/enrich.mjs';

const HOME = os.homedir();
const DISCOVERABLE = ['claude', 'antigravity', 'codex'];

function parseArgs(argv) {
  const args = {
    all: false, agents: [], dryRun: false, limit: null, since: null, vault: null, timezone: null,
    skipAiMemory: false, skipVault: false, exportDir: null, file: null, force: false,
    includeSubagents: false, enrich: false, enrichLimit: 10, enrichModel: DEFAULT_ENRICH_MODEL, sourceHome: null, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') args.all = true;
    else if (a === '--agent') args.agents.push(...String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') args.limit = Number(argv[++i]) || null;
    else if (a === '--since') args.since = argv[++i];
    else if (a === '--vault') args.vault = argv[++i];
    else if (a === '--timezone') args.timezone = argv[++i];
    else if (a === '--skip-ai-memory') args.skipAiMemory = true;
    else if (a === '--skip-vault') args.skipVault = true;
    else if (a === '--export-dir') args.exportDir = argv[++i];
    else if (a === '--file') args.file = argv[++i];
    else if (a === '--force') args.force = true;
    else if (a === '--include-subagents') args.includeSubagents = true;
    else if (a === '--source-home') args.sourceHome = argv[++i];
    else if (a === '--enrich') args.enrich = true;
    else if (a === '--enrich-limit') args.enrichLimit = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--enrich-model') args.enrichModel = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

const HELP = `
Uso: node bin/ingest-sessions.mjs [opções]

Fontes
  --all                       Varre todos os agentes detectados (claude, antigravity, codex).
  --agent <nome[,nome2]>      Só esses agentes: claude | antigravity | codex.
  --file <caminho>            Export avulso do Claude Desktop/Web (conversations.json).
  --include-subagents         Inclui transcrições de subagentes (puladas por padrão, são ruído).
  --since <YYYY-MM-DD>        Só sessões a partir dessa data.
  --source-home <pasta>       Procura as sessões nessa "home" em vez da sua (ex: backup de outra máquina).
  --limit <N>                 Só as N sessões mais recentes por agente.

Destinos
  --vault <caminho>           Obsidian Vault (padrão: o do muri-saver.json, senão ~/Documents/Obsidian Vault).
  --skip-vault                Não grava no Obsidian.
  --skip-ai-memory            Não grava no ai-memory.
  --export-dir <caminho>      Só exporta Markdown avulso pra essa pasta (ignora vault e ai-memory).

Enriquecimento (opt-in, usa LLM)
  --enrich                    Gera narrativa + taxonomia via \`claude -p\` (Haiku) pras sessões substanciais.
  --enrich-limit <N>          Máximo de sessões enriquecidas por rodada (padrão: 10).
  --enrich-model <modelo>     Modelo usado (padrão: ${DEFAULT_ENRICH_MODEL}).

Outros
  --timezone <IANA>           Fuso pros nomes de arquivo (padrão: o do muri-saver.json, senão o do sistema).
  --dry-run                   Só lista o que seria feito, não escreve nada.
  --force                     Reimporta mesmo se já estiver no cache de idempotência.
  --help                      Esta ajuda.

Exemplos
  node bin/ingest-sessions.mjs --all --dry-run
  node bin/ingest-sessions.mjs --agent claude --limit 20
  node bin/ingest-sessions.mjs --all --since 2026-09-01 --enrich --enrich-limit 5
  node bin/ingest-sessions.mjs --file ./conversations.json --export-dir ./out
`;

function log(msg) {
  console.log(`[ingest-sessions] ${msg}`);
}

function fingerprint(path) {
  try {
    const st = statSync(path);
    return `${st.size}:${Math.floor(st.mtimeMs)}`;
  } catch {
    return null;
  }
}

function withinSince(mtimeMs, since) {
  if (!since) return true;
  const t = Date.parse(since);
  return Number.isNaN(t) ? true : mtimeMs >= t;
}

function resolveAiMemoryBin() {
  if (process.env.MURI_SAVER_AI_MEMORY_BIN) return process.env.MURI_SAVER_AI_MEMORY_BIN;
  const candidates = process.platform === 'win32'
    ? [join(HOME, '.cargo', 'bin', 'ai-memory.exe')]
    : [join(HOME, '.local', 'bin', 'ai-memory')];
  return candidates.find(existsSync) || 'ai-memory';
}

let aiMemoryAvailable = null;
function writeToAiMemory(s, markdown) {
  const bin = resolveAiMemoryBin();
  if (aiMemoryAvailable === null) {
    try {
      execTool(bin, ['--version'], { stdio: 'pipe' });
      aiMemoryAvailable = true;
    } catch {
      aiMemoryAvailable = false;
    }
  }
  if (!aiMemoryAvailable) return { written: false, reason: 'binário ai-memory não encontrado' };
  const args = ['write-page', '--path', `sessions/imported-${s.agent}-${s.dateStr}-${s.idShort}.md`, '--body', '-', '--tier', 'episodic'];
  for (const t of ['session', s.agent, 'muri-saver', 'imported', ...(s.project ? [s.project] : [])]) args.push('-t', t);
  if (s.project) args.push('--project', s.project);
  try {
    execTool(bin, args, { input: markdown, stdio: ['pipe', 'pipe', 'pipe'] });
    return { written: true, path: args[2] };
  } catch (err) {
    return { written: false, reason: (err?.stderr?.toString?.() || err?.message || String(err)).split('\n')[0].slice(0, 200) };
  }
}

function exportMarkdown(dir, s, markdown) {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${s.agent}-${s.dateStr}_${s.timeStr}-${s.idShort}.md`);
  writeFileSync(p, markdown);
  return p;
}

async function collectRefs(args) {
  if (args.file) {
    if (!existsSync(args.file)) throw new Error(`--file "${args.file}" não encontrado`);
    const res = parseDesktopFile(args.file);
    log(`desktop: ${res.refs.length} conversa(s) reconhecida(s) em ${args.file}`);
    res.notes.forEach((n) => log(`  AVISO: ${n}`));
    return res.refs;
  }
  const invalid = args.agents.filter((a) => !DISCOVERABLE.includes(a));
  invalid.forEach((a) => log(`AVISO: agente "${a}" ignorado (válidos: ${DISCOVERABLE.join(', ')}; desktop só via --file).`));
  const selected = args.all ? DISCOVERABLE : args.agents.filter((a) => DISCOVERABLE.includes(a));
  const refs = [];
  for (const agent of selected) {
    const res = await discoverAgent(agent, args.sourceHome || HOME, { includeSubagents: args.includeSubagents });
    let agentRefs = res.refs.filter((r) => withinSince(r.mtimeMs, args.since)).sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (args.limit) agentRefs = agentRefs.slice(0, args.limit);
    const extras = [
      args.since ? `desde ${args.since}` : null,
      args.limit ? `limitado a ${args.limit}` : null,
      res.skippedSubagents ? `${res.skippedSubagents} de subagentes puladas (--include-subagents inclui)` : null,
    ].filter(Boolean);
    log(`${agent}: ${agentRefs.length} sessão(ões)${extras.length ? ` — ${extras.join(', ')}` : ''}`);
    res.notes.forEach((n) => log(`  AVISO: ${n}`));
    refs.push(...agentRefs);
  }
  return refs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(HELP);
  if (!args.all && !args.agents.length && !args.file) {
    log('Nada a fazer: passe --all, --agent <nome> ou --file <caminho>. Use --help pra ver as opções.');
    return;
  }

  const config = readConfig(configPath());
  const vault = resolveVault({ cliVault: args.vault, config });
  const timeZone = resolveTimezone({ cliTimezone: args.timezone, config });
  const doExport = Boolean(args.exportDir);
  const doVault = !doExport && !args.skipVault;
  const doAiMemory = !doExport && !args.skipAiMemory;

  log(`SO: ${process.platform} — fuso: ${timeZone}${doVault ? ` — vault: ${vault}` : ''}`);
  if (args.dryRun) log('MODO --dry-run: nada será escrito.');
  if (doExport) log(`Modo --export-dir (${args.exportDir}) — vault e ai-memory ignorados.`);
  if (args.enrich) log(`--enrich ativo: até ${args.enrichLimit} sessão(ões) substanciais por rodada, teto de US$ ${DEFAULT_MAX_BUDGET_USD.toFixed(2)} por chamada (${args.enrichModel}).`);

  let refs;
  try {
    refs = await collectRefs(args);
  } catch (err) {
    log(`FALHA: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (!refs.length) return log('Nenhuma sessão encontrada pros critérios passados.');

  const sourceHome = args.sourceHome || HOME;
  if (args.sourceHome) log(`Lendo sessões de ${sourceHome} (--source-home).`);
  const cachePath = join(sourceHome, '.claude', 'cache', '.muri-saver-ingested.json');
  const cache = readConfig(cachePath) || { version: 1, entries: {} };
  cache.entries = cache.entries || {};
  const knownProjects = doVault ? listKnownProjects(vault) : [];
  const claudeBin = args.enrich ? resolveClaudeBin() : null;
  const todayStr = dateParts(new Date(), timeZone).date;
  const stats = { imported: 0, cached: 0, empty: 0, failed: 0, enriched: 0, enrichFailed: 0 };
  let enrichBudget = args.enrich ? args.enrichLimit : 0;

  for (const ref of refs) {
    const key = `${ref.agent}:${ref.id}`;
    const fp = ref.kind === 'codex-sqlite' ? `sqlite:${ref.mtimeMs}` : fingerprint(ref.sourcePaths[0]);
    const cached = doExport ? null : cache.entries[key];
    const alreadyDone = !args.force && cached && (ref.agent === 'desktop' || cached.fingerprint === fp);

    if (args.dryRun) {
      const tag = ref.kind === 'codex-sqlite' ? ' [sqlite]' : '';
      log(`  [${ref.agent}] ${ref.idShort}${tag} — ${alreadyDone ? 'já importado (cache)' : 'seria importado'}${ref.title ? ` — "${ref.title.slice(0, 50)}"` : ''}`);
      continue;
    }
    if (alreadyDone) {
      stats.cached++;
      continue;
    }

    const parsed = await parseSession(ref);
    if (!parsed.exchanges.length) {
      stats.empty++;
      continue;
    }

    const start = toDate(parsed.startedAt, ref.mtimeMs);
    const { date: dateStr, time: timeStr } = dateParts(start, timeZone);
    const s = {
      agent: ref.agent, id: ref.id, idShort: ref.idShort, dateStr, timeStr, todayStr,
      exchanges: parsed.exchanges, toolCallCount: parsed.toolCallCount || 0,
      project: ref.agent === 'desktop' ? null : projectLabelFromCwd(parsed.cwd),
      title: parsed.title || ref.title || null,
    };

    let summary = null;
    const substantial = s.exchanges.filter((e) => e.role === 'user').length >= 2;
    if (enrichBudget > 0 && substantial) {
      enrichBudget--;
      const res = enrichSession({ exchanges: s.exchanges, agentLabel: AGENT_LABEL[s.agent], knownProjects, claudeBin, model: args.enrichModel });
      if (res.summary) {
        summary = res.summary;
        stats.enriched++;
      } else {
        stats.enrichFailed++;
        log(`  [${ref.agent}] ${ref.idShort} — enriquecimento falhou (${res.error}), gravando dump local`);
      }
    }
    const markdown = summary ? buildEnrichedSessionMarkdown(s, summary) : buildRawSessionMarkdown(s);

    const results = [];
    let ok = true;
    try {
      if (doExport) results.push(`export -> ${exportMarkdown(args.exportDir, s, markdown)}`);
      if (doVault) {
        const r = writeSessionToVault(vault, s, { markdown, summary });
        results.push(r.written ? `vault -> ${basename(r.path)}${r.touchedProjects?.length ? ` (+taxonomia: ${r.touchedProjects.join(', ')})` : ''}` : `vault: ${r.reason}`);
      }
      if (doAiMemory) {
        const r = writeToAiMemory(s, markdown);
        results.push(r.written ? `ai-memory -> ${r.path}` : `ai-memory: ${r.reason}`);
      }
    } catch (err) {
      ok = false;
      results.push(`FALHOU: ${err.message}`);
    }

    log(`  [${ref.agent}] ${ref.idShort}${summary ? ' ✨' : ''} — ${results.join(' | ')}`);
    if (ok) {
      stats.imported++;
      if (!doExport) cache.entries[key] = { fingerprint: fp, importedAt: new Date().toISOString(), enriched: Boolean(summary) };
    } else {
      stats.failed++;
    }
  }

  if (args.dryRun) {
    const enrichNote = args.enrich ? ` Até ${Math.min(args.enrichLimit, refs.length)} seriam enriquecidas (teto: US$ ${(Math.min(args.enrichLimit, refs.length) * DEFAULT_MAX_BUDGET_USD).toFixed(2)}).` : '';
    return log(`Resumo (dry-run): ${refs.length} sessão(ões) avaliada(s). Nada foi escrito.${enrichNote}`);
  }
  if (!doExport) writeConfig(cachePath, cache);
  log(`Resumo: ${stats.imported} importada(s)${args.enrich ? ` (${stats.enriched} enriquecida(s), ${stats.enrichFailed} com falha no enriquecimento)` : ''}, ${stats.cached} já em cache, ${stats.empty} sem conteúdo, ${stats.failed} com falha.`);
}

main();
