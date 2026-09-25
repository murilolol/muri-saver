// Same 12 categories hooks/obsidian-vault-check.mjs uses (ASCII folder names
// on purpose — avoids encoding issues in git/terminal/URLs).
export const CATEGORY_DIRS = {
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

export const CATEGORY_EMOJI = {
  bug: '🐛', pedido: '📩', melhoria: '✨', correcao: '🔧', prompt: '💬',
  duvida: '❓', ideia: '💡', decisao: '🧭', 'divida-tecnica': '🩹',
  pesquisa: '🔍', release: '🚀', risco: '⚠️',
};

export const STATUS_CATEGORIES = new Set(['bug', 'pedido', 'melhoria', 'risco', 'divida-tecnica']);
export const PRIORITY_CATEGORIES = new Set(['bug', 'risco', 'divida-tecnica']);
export const VALID_ORIGENS = new Set(['usuario', 'ia', 'sistema']);

export function slugify(text, max = 40) {
  return String(text)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, max)
    .replace(/-+$/, '') || 'item';
}
