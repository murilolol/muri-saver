import { execFileSync } from 'node:child_process';
import { execTool } from './exec.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { CATEGORY_DIRS, STATUS_CATEGORIES, PRIORITY_CATEGORIES, VALID_ORIGENS } from './taxonomy.mjs';

export const DEFAULT_ENRICH_MODEL = 'claude-haiku-4-5-20251001';
export const DEFAULT_MAX_BUDGET_USD = 0.2;
export const MAX_EXCERPT_CHARS = 45000;

export function resolveClaudeBin(env = process.env, home = os.homedir()) {
  if (env.MURI_SAVER_CLAUDE_BIN) return env.MURI_SAVER_CLAUDE_BIN;
  if (process.platform !== 'win32') {
    const local = join(home, '.local', 'bin', 'claude');
    return existsSync(local) ? local : 'claude';
  }
  const candidates = [join(home, 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')];
  try {
    const shim = execFileSync('where', ['claude.cmd'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    if (shim) candidates.unshift(join(shim.replace(/[\\/]claude\.cmd$/i, ''), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
  } catch {
    // `where` missing — keep the fixed candidate
  }
  return candidates.find(existsSync) || 'claude';
}

// Keeps the opening request (first 25%) and the resolution (last 75%) when a
// session is too long for one cheap call.
export function buildExcerpt(exchanges, maxChars = MAX_EXCERPT_CHARS) {
  const text = exchanges.map((e) => `${e.role}: ${e.text}`).join('\n');
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.25);
  return `${text.slice(0, head)}\n\n[... trecho intermediário omitido ...]\n\n${text.slice(-(maxChars - head))}`;
}

export function buildEnrichInstructions(agentLabel, knownProjects) {
  return [
    `A entrada padrão (stdin) contém a transcrição de uma sessão real de um agente de codificação (${agentLabel}).`,
    'Gere documentação técnica para o Obsidian Vault do desenvolvedor.',
    'Escreva todos os textos em português do Brasil (nomes de arquivo, código e termos técnicos podem ficar como estão).',
    'Responda APENAS com um objeto JSON válido (sem texto antes/depois, sem markdown wrapper):',
    '{"titulo_curto":"5 a 12 palavras","resumo_executivo":["1 a 3 parágrafos"],"decisoes":["..."],"acoes_realizadas":["..."],"orientacoes_e_respostas_ia":["..."],"entregaveis_e_arquivos":["caminho/arquivo"],"tags_extra":["tag-kebab"],"itens_categorizados":[{"categoria":"bug|pedido|melhoria|correcao|prompt|duvida|ideia|decisao|divida-tecnica|pesquisa|release|risco","projeto":"slug-exato-da-lista","titulo":"5 a 12 palavras","texto":"1-3 frases","origem":"usuario|ia|sistema","status":"aberto|em-andamento|feito","prioridade":"baixa|media|alta|critica"}]}',
    'Regras: listas vazias [] quando não houver conteúdo real; tags_extra com 3 a 5 tags curtas; no máximo 8 itens_categorizados.',
    `Projetos conhecidos (use EXATAMENTE um destes em "projeto", nunca invente): ${knownProjects.join(', ') || '(nenhum — deixe itens_categorizados vazio)'}`,
  ].join('\n');
}

export function parseEnrichOutput(out, knownProjects = []) {
  const match = String(out || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed?.titulo_curto) return null;
  const list = (v, n) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, n) : []);
  const known = new Set(knownProjects);
  return {
    titulo_curto: String(parsed.titulo_curto),
    resumo_executivo: list(parsed.resumo_executivo, 3).length ? list(parsed.resumo_executivo, 3) : [String(parsed.titulo_curto)],
    decisoes: list(parsed.decisoes, 8),
    acoes_realizadas: list(parsed.acoes_realizadas, 10),
    orientacoes_e_respostas_ia: list(parsed.orientacoes_e_respostas_ia, 8),
    entregaveis_e_arquivos: list(parsed.entregaveis_e_arquivos, 12),
    tags_extra: list(parsed.tags_extra, 5).map((t) => t.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/(^-|-$)/g, '')).filter(Boolean),
    itens_categorizados: (Array.isArray(parsed.itens_categorizados) ? parsed.itens_categorizados : [])
      .filter((it) => it && CATEGORY_DIRS[it.categoria] && known.has(it.projeto) && it.titulo)
      .map((it) => ({
        categoria: it.categoria,
        projeto: it.projeto,
        titulo: String(it.titulo),
        texto: String(it.texto || ''),
        origem: VALID_ORIGENS.has(it.origem) ? it.origem : 'ia',
        status: STATUS_CATEGORIES.has(it.categoria) ? (it.status || 'aberto') : '',
        prioridade: PRIORITY_CATEGORIES.has(it.categoria) ? (it.prioridade || 'media') : '',
      }))
      .slice(0, 8),
  };
}

export function enrichSession({
  exchanges, agentLabel, knownProjects = [], claudeBin, env = process.env,
  model = DEFAULT_ENRICH_MODEL, maxBudgetUsd = DEFAULT_MAX_BUDGET_USD, timeoutMs = 120000,
}) {
  const excerpt = buildExcerpt(exchanges);
  if (!excerpt) return { error: 'sessão sem conteúdo pra resumir' };
  const args = [
    '-p', buildEnrichInstructions(agentLabel, knownProjects),
    '--model', model,
    '--output-format', 'text',
    '--permission-prompts', 'none',
    '--no-session-persistence',
    '--max-budget-usd', String(maxBudgetUsd),
  ];
  try {
    const out = execTool(claudeBin, args, {
      input: excerpt,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...env, MURI_SAVER_OBSIDIAN_GEN: '1' },
    });
    const summary = parseEnrichOutput(out, knownProjects);
    return summary ? { summary } : { error: 'resposta da LLM sem JSON válido' };
  } catch (err) {
    const msg = err?.stderr?.toString?.() || err?.message || String(err);
    return { error: msg.split('\n')[0].slice(0, 200) };
  }
}
