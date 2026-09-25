import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { sanitize, yamlQuote, maskSecrets, stripSystemTags, escapeStrayHtml } from './sanitize.mjs';
import { CATEGORY_DIRS, CATEGORY_EMOJI, slugify } from './taxonomy.mjs';

export const AGENT_LABEL = { claude: 'Claude', antigravity: 'Antigravity', codex: 'Codex', desktop: 'Claude Desktop/Web' };
export const AGENT_ICON = { claude: '🟧', antigravity: '🤖', codex: '🧩', desktop: '💻' };
export const AGENT_FILE_TAG = { claude: 'Claude', antigravity: 'AGY', codex: 'Codex', desktop: 'Desktop' };

const MAX_DUMP_CHARS = 60000;

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function fileGlobExists(dirPath, fragment) {
  try {
    return readdirSync(dirPath).some((f) => f.includes(fragment));
  } catch {
    return false;
  }
}

export function listKnownProjects(vault) {
  try {
    return readdirSync(join(vault, 'projects'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export function sessionFileName({ agent, dateStr, timeStr, idShort }) {
  return `Session-${dateStr}_${timeStr}-${AGENT_FILE_TAG[agent]}-${idShort}.md`;
}

function exchangesBody(exchanges) {
  if (!exchanges.length) return '_Nenhum prompt substantivo capturado nesta sessão._';
  let body = exchanges
    .map((e) => `${e.role === 'user' ? '🧑 **Usuário**' : '🤖 **IA**'}\n\n${sanitize(e.text)}`)
    .join('\n\n---\n\n');
  if (body.length > MAX_DUMP_CHARS) {
    const head = Math.floor(MAX_DUMP_CHARS * 0.5);
    body = `${body.slice(0, head)}\n\n[... trecho intermediário omitido pelo ingestor ...]\n\n${body.slice(-(MAX_DUMP_CHARS - head))}`;
  }
  return body;
}

// Clean first, cut after: truncating raw text can split a secret or a system
// tag in half, and the half no longer matches the patterns that remove it.
export function excerpt(text, max) {
  const cleaned = stripSystemTags(maskSecrets(String(text || ''))).replace(/\s+/g, ' ').trim();
  const cut = cleaned.length > max ? `${cleaned.slice(0, max - 1).replace(/<[^>]*$/, '').trimEnd()}…` : cleaned;
  return escapeStrayHtml(cut);
}

function titleFrom(exchanges, title) {
  const firstUser = exchanges.find((e) => e.role === 'user');
  return excerpt(title || (firstUser ? firstUser.text : 'Sessão importada'), 80);
}

function frontmatter({ title, agent, dateStr, idShort, generated, tags }) {
  return `---
title: ${yamlQuote(title)}
agent: ${agent}
date_start: ${dateStr}
session_id: ${idShort}
tier: episodic
status: concluded
generated: ${generated}
tags:
${tags.map((t) => `  - ${t}`).join('\n')}
---`;
}

function metaLines({ agent, id, idShort, dateStr, timeStr, project, toolCallCount, enriched }) {
  return [
    `- **ID da Sessão:** \`${idShort}\` (\`${id}\`)`,
    `- **Agente:** ${AGENT_LABEL[agent]}`,
    `- **Data:** ${dateStr} às ${timeStr}`,
    project ? `- **Projeto detectado:** \`${sanitize(project)}\`` : null,
    `- **Comandos/tool calls detectados:** ${toolCallCount}`,
    enriched
      ? '- **Importado por:** `bin/ingest-sessions.mjs --enrich` — narrativa gerada por LLM a partir da transcrição local.'
      : '- **Importado por:** `bin/ingest-sessions.mjs` — sem chamada de LLM, extração 100% local.',
  ].filter(Boolean).join('\n');
}

const graphFooter = (agent, dateStr) =>
  `## 🌐 Conexões Globais no Grafo\n[[${agent}/README|Central ${AGENT_LABEL[agent]}]] [[dailies/Daily-${dateStr}|Diário de Bordo ${dateStr}]]\n`;

export function buildRawSessionMarkdown(s) {
  const titulo = titleFrom(s.exchanges, s.title);
  const label = AGENT_LABEL[s.agent];
  return `${frontmatter({
    title: `Sessão ${label} ${s.idShort} (importada) — ${titulo}`,
    agent: s.agent, dateStr: s.dateStr, idShort: s.idShort, generated: 'ingest-sessions',
    tags: ['session', s.agent, 'muri-saver', 'imported'],
  })}

# ${AGENT_ICON[s.agent]} Sessão ${label} ${s.idShort} (importada)

🏷️ **Tags:** #session #${s.agent} #muri-saver #imported

${metaLines({ ...s, enriched: false })}

---

## 💬 Prompts & Respostas (importado)

${exchangesBody(s.exchanges)}

---

${graphFooter(s.agent, s.dateStr)}`;
}

const bulletSection = (title, items, code = false) =>
  items.length ? `\n---\n\n## ${title}\n\n${items.map((i) => (code ? `- \`${sanitize(i)}\`` : `- ${sanitize(i)}`)).join('\n')}\n` : '';

export function buildEnrichedSessionMarkdown(s, summary) {
  const label = AGENT_LABEL[s.agent];
  const titulo = sanitize(summary.titulo_curto).replace(/\s+/g, ' ').trim();
  const tags = ['session', s.agent, 'muri-saver', 'imported', ...summary.tags_extra.filter((t) => !['session', s.agent, 'muri-saver', 'imported'].includes(t))];
  return `${frontmatter({
    title: `Sessão ${label} ${s.idShort} — ${titulo}`,
    agent: s.agent, dateStr: s.dateStr, idShort: s.idShort, generated: 'ingest-sessions-enriched', tags,
  })}

# ${AGENT_ICON[s.agent]} Sessão ${label} ${s.idShort} — ${titulo}

🏷️ **Tags:** ${tags.map((t) => `#${t}`).join(' ')}

${metaLines({ ...s, enriched: true })}

---

## 📝 Síntese Executiva

${summary.resumo_executivo.map(sanitize).join('\n\n')}
${bulletSection('🧭 Decisões Técnicas & Arquiteturais', summary.decisoes)}${bulletSection('⚡ Ações Realizadas & Implementações', summary.acoes_realizadas)}${bulletSection('💡 Orientações & Respostas Chave da IA', summary.orientacoes_e_respostas_ia)}${bulletSection('📦 Arquivos & Entregáveis', summary.entregaveis_e_arquivos, true)}
---

## 💬 Transcrição importada

${exchangesBody(s.exchanges)}

---

${graphFooter(s.agent, s.dateStr)}`;
}

function dailySkeleton(dateStr) {
  return `---
title: Diário de Bordo — ${dateStr}
kind: fact
pinned: true
tier: episodic
tags:
  - daily
  - session
  - log
  - muri-saver
---

# 📅 Diário de Bordo — ${dateStr}

Registro cronológico de atividades. Gerado/mesclado automaticamente.

---

## 📋 Sessões do Dia

<!-- ENTRIES -->

---

## 🌐 Conexões Globais no Grafo
[[Hub-Projects|Central de Projetos]] [[Hub-Agents|Central de Agentes]]
`;
}

export function appendDailyEntry(dailyPath, entry, dateStr) {
  if (!existsSync(dailyPath)) {
    ensureDir(dirname(dailyPath));
    writeFileSync(dailyPath, dailySkeleton(dateStr).replace('<!-- ENTRIES -->', `${entry}\n<!-- ENTRIES -->`));
    return;
  }
  const content = readFileSync(dailyPath, 'utf8');
  if (content.includes('<!-- ENTRIES -->')) {
    writeFileSync(dailyPath, content.replace('<!-- ENTRIES -->', `${entry}\n<!-- ENTRIES -->`));
    return;
  }
  const marker = '## 🌐 Conexões Globais no Grafo';
  if (content.includes(marker)) {
    writeFileSync(dailyPath, content.replace(marker, `${entry}\n\n---\n\n${marker}`));
    return;
  }
  appendFileSync(dailyPath, `\n\n---\n\n${entry}\n`);
}

// Codex keeps its own codex/dailies/ (same convention as its live hook), the
// rest share the cross-agent dailies/ root.
export function dailyPathFor(vault, agent, dateStr) {
  if (agent === 'codex') return join(vault, 'codex', 'dailies', `Daily-${dateStr}.md`);
  return join(vault, 'dailies', `Daily-${dateStr}.md`);
}

export function writeClassifiedNotes(vault, items, { dateStr, idShort, agent, sessionLink }) {
  const touched = new Set();
  items.forEach((item, i) => {
    const dir = join(vault, 'projects', item.projeto, CATEGORY_DIRS[item.categoria]);
    ensureDir(dir);
    const filePath = join(dir, `${item.categoria}-${dateStr}-${idShort}-${String(i + 1).padStart(2, '0')}-${slugify(item.titulo)}.md`);
    if (existsSync(filePath)) return;
    const titulo = sanitize(item.titulo).replace(/\s+/g, ' ').trim();
    const meta = [item.status ? `**Status:** ${item.status}` : null, item.prioridade ? `**Prioridade:** ${item.prioridade}` : null].filter(Boolean).join(' · ');
    writeFileSync(filePath, `---
title: ${yamlQuote(titulo)}
projeto: ${item.projeto}
categoria: ${item.categoria}
origem: ${item.origem}
${item.status ? `status: ${item.status}\n` : ''}${item.prioridade ? `prioridade: ${item.prioridade}\n` : ''}origem_sessao: "[[${sessionLink}]]"
date: ${dateStr}
generated: ingest-sessions-enriched
tags:
  - ${item.categoria}
  - ${item.projeto}
---

# ${CATEGORY_EMOJI[item.categoria] || '📝'} ${titulo}

🏷️ **Tags:** #${item.categoria} #${item.projeto}

- **Projeto:** [[projects/${item.projeto}/README|${item.projeto}]]
${meta ? `- ${meta}\n` : ''}- **Origem:** ${item.origem}
- **Sessão de origem:** [[${sessionLink}|Sessão ${AGENT_LABEL[agent]} ${idShort}]]
- **Data:** ${dateStr}

${sanitize(item.texto)}
`);
    touched.add(item.projeto);
  });
  return touched;
}

export function updateProjectDashboard(vault, projeto, todayStr) {
  const projectDir = join(vault, 'projects', projeto);
  const readmePath = join(projectDir, 'README.md');
  if (!existsSync(readmePath)) return;
  const rows = Object.entries(CATEGORY_DIRS).map(([key, dirName]) => {
    let count = 0;
    try {
      count = readdirSync(join(projectDir, dirName)).filter((f) => f.endsWith('.md') && f !== 'README.md').length;
    } catch {
      count = 0;
    }
    return `| ${CATEGORY_EMOJI[key]} ${dirName} | ${count} |`;
  });
  const block = `<!-- CATEGORY_COUNTS -->\n| Categoria | Itens |\n|---|---|\n${rows.join('\n')}\n\n_Atualizado automaticamente em ${todayStr}._\n<!-- /CATEGORY_COUNTS -->`;
  const content = readFileSync(readmePath, 'utf8');
  if (content.includes('<!-- CATEGORY_COUNTS -->') && content.includes('<!-- /CATEGORY_COUNTS -->')) {
    writeFileSync(readmePath, content.replace(/<!-- CATEGORY_COUNTS -->[\s\S]*?<!-- \/CATEGORY_COUNTS -->/, block));
  } else {
    writeFileSync(readmePath, `${content.trimEnd()}\n\n## 📊 Dashboard (auto)\n${block}\n`);
  }
}

export function writeSessionToVault(vault, s, { markdown, summary }) {
  const sessionsDir = join(vault, s.agent, 'sessions');
  ensureDir(sessionsDir);
  if (fileGlobExists(sessionsDir, `-${s.idShort}.md`)) return { written: false, reason: 'já existe uma sessão com esse id no vault' };
  const fileName = sessionFileName(s);
  writeFileSync(join(sessionsDir, fileName), markdown);
  const link = `${s.agent}/sessions/${fileName.replace(/\.md$/, '')}`;

  const dailyPath = dailyPathFor(vault, s.agent, s.dateStr);
  let alreadyInDaily = false;
  try {
    alreadyInDaily = readFileSync(dailyPath, 'utf8').includes(s.idShort);
  } catch {
    alreadyInDaily = false;
  }
  if (!alreadyInDaily) {
    const firstUser = s.exchanges.find((e) => e.role === 'user');
    const resumo = summary
      ? excerpt(summary.resumo_executivo[0], 200)
      : excerpt(firstUser ? firstUser.text : 'Sessão importada sem prompts substantivos', 140);
    const projectNote = s.project ? ` _(projeto: ${sanitize(s.project)})_` : '';
    const badge = summary ? '📥✨ _importado + enriquecido_' : '📥 _importado_';
    const detail = summary ? '' : ' _(importado retroativamente, sem custo de LLM)_';
    appendDailyEntry(dailyPath, `### [[${link}|Sessão ${AGENT_LABEL[s.agent]} ${s.idShort}]] (${s.timeStr}) ${badge}\n- **Resumo:** ${resumo}${projectNote}${detail}`, s.dateStr);
  }

  let touchedProjects = [];
  if (summary?.itens_categorizados?.length) {
    touchedProjects = [...writeClassifiedNotes(vault, summary.itens_categorizados, { dateStr: s.dateStr, idShort: s.idShort, agent: s.agent, sessionLink: link })];
    for (const p of touchedProjects) updateProjectDashboard(vault, p, s.todayStr || s.dateStr);
  }
  return { written: true, path: join(sessionsDir, fileName), touchedProjects };
}
