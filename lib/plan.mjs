import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execTool } from './exec.mjs';
import { resolveClaudeBin } from './enrich.mjs';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const PLAN_PROFILES = JSON.parse(readFileSync(join(REPO_ROOT, 'hooks', 'plan-profiles.json'), 'utf8'));
// Perfil pelo id, ou null. Object.hasOwn: "__proto__" ou "constructor" não são perfis.
export const profileOf = (id) => (Object.hasOwn(PLAN_PROFILES.perfis, id) ? PLAN_PROFILES.perfis[id] : null);

// planTier, subscriptionType, "Claude <X> account", planDisplayName ou rateLimitTier → id do perfil.
// 20x antes de max: max_20x é o Ultra (o nome antigo do Max 20x).
// CLI antiga sem planTier: numa conta 20x, subscriptionType "max" e o --text "Claude Max account" dão
// max, não ultra. O doctor mostra o detectado e --plan corrige.
export function planFromName(name) {
  const s = String(name || '').toLowerCase();
  if (/20x|ultra/.test(s)) return 'ultra';
  if (/5x|max/.test(s)) return 'max';
  return ['pro', 'team', 'enterprise'].find((p) => s.includes(p)) || null;
}

// Cascata: `claude auth status` (JSON) → `--text` → ~/.claude.json. Os campos de plano não são
// documentados e podem mudar; sem resposta, fica "auto" (ninguém muda de comportamento).
export function detectPlan({ claudeBin = resolveClaudeBin(), home = os.homedir() } = {}) {
  // Sem ~/.claude.json o Claude Code nunca rodou aqui (deslogado), e rodar o `claude` criaria a config
  // dele no HOME: o --dry-run e o doctor não podem escrever.
  if (!existsSync(join(home, '.claude.json'))) return { plan: 'auto', source: null };
  const run = (args) => {
    try {
      return execTool(claudeBin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 });
    } catch (err) {
      return err.stdout || ''; // deslogado, `auth status` imprime o JSON e sai com 1
    }
  };
  try {
    const j = JSON.parse(run(['auth', 'status']));
    if (['api_key', 'api_key_helper', 'third_party'].includes(j.authMethod)) return { plan: 'api', source: 'claude auth status' };
    // Deslogado ou token avulso: o ~/.claude.json pode ser de outra conta, então fica a pergunta.
    if (['none', 'oauth_token'].includes(j.authMethod)) return { plan: 'auto', source: null };
    const plan = planFromName(j.planTier) || planFromName(j.subscriptionType);
    if (plan) return { plan, source: 'claude auth status' };
  } catch {
    // CLI ausente, antiga ou saída que não é JSON: tenta o próximo
  }
  const text = planFromName((run(['auth', 'status', '--text']).match(/Claude (\w+) account/) || [])[1]);
  if (text) return { plan: text, source: 'claude auth status --text' };
  try {
    const acc = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')).oauthAccount || {};
    const plan = planFromName(acc.planDisplayName) || planFromName(acc.organizationRateLimitTier);
    if (plan) return { plan, source: '~/.claude.json' };
  } catch {
    // arquivo interno do Claude Code: ausente ou em outro formato
  }
  return { plan: 'auto', source: null };
}
