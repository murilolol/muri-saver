import { DEFAULT_ALIAS } from './config.mjs';

export function sanitizeAlias(raw) {
  const slug = String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return slug || DEFAULT_ALIAS;
}

export function aliasForms(alias) {
  const parts = alias.split('-').filter(Boolean);
  const title = parts.map((w) => w[0].toUpperCase() + w.slice(1));
  return {
    lower: alias,
    spaced: parts.join(' '),
    titleDashed: title.join('-'),
    titleSpaced: title.join(' '),
  };
}

// A single-word alias ("lucas") makes the dashed and spaced trigger forms
// identical, which would otherwise read as `"lucas", "lucas" ou "/lucas"`.
function dedupeRepeatedTriggers(content, token) {
  let out = content;
  for (const q of ['"', '`']) {
    for (const sep of [', ', '/', ' ou ', ' or ']) {
      const repeated = `${q}${token}${q}${sep}${q}${token}${q}`;
      while (out.includes(repeated)) out = out.split(repeated).join(`${q}${token}${q}`);
    }
  }
  return out;
}

export function applyAliasForms(content, alias) {
  if (alias === DEFAULT_ALIAS) return content;
  const f = aliasForms(alias);
  let out = content
    .split('Muri-Saver').join(f.titleDashed)
    .split('Muri Saver').join(f.titleSpaced)
    .split('muri-saver').join(f.lower)
    .split('muri saver').join(f.spaced);
  if (f.spaced === f.lower) out = dedupeRepeatedTriggers(out, f.lower);
  return out;
}

export function aliasNote(alias) {
  const f = aliasForms(alias);
  const triggers = [...new Set([f.spaced, f.lower])].map((t) => `"${t}"`);
  triggers.push(`"/${f.lower}"`);
  return `> **Alias personalizado:** instalado com o alias \`${alias}\`. Gatilhos: ${triggers.join(', ')} — ` +
    `e "muri-saver"/"muri saver"/"/muri-saver" continuam funcionando como alias alternativo herdado do ` +
    `padrão original do projeto.\n`;
}

// Right after YAML frontmatter (SKILL.md) or right after the H1 title
// (CLAUDE.md/GEMINI.md/AGENTS.md).
export function injectAliasNote(content, alias) {
  const note = aliasNote(alias);
  const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (fmMatch) {
    const idx = fmMatch[0].length;
    return `${content.slice(0, idx)}\n${note}${content.slice(idx)}`;
  }
  const firstLineEnd = content.indexOf('\n');
  if (firstLineEnd === -1) return `${content}\n\n${note}`;
  return `${content.slice(0, firstLineEnd + 1)}\n${note}${content.slice(firstLineEnd + 1)}`;
}

export function renderWithAlias(content, alias) {
  if (alias === DEFAULT_ALIAS) return content;
  return injectAliasNote(applyAliasForms(content, alias), alias);
}
