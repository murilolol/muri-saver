import { isDeepStrictEqual } from 'node:util';
import os from 'node:os';

export const jsonEqual = (a, b) => isDeepStrictEqual(a, b);

function isMetaKey(key) {
  return key.startsWith('_comment') || key.startsWith('_nota');
}

// Identidade de um hook = caminho do primeiro script (.py/.mjs) que ele roda,
// em `command` ou, se lá não houver, em `args`. Assim `python3 X/guarda.py` e
// {command: "python3", args: ["X/guarda.py"]} são o mesmo hook, e um
// statusMessage ou timeout diferente não duplica a entrada. Só o primeiro: um
// hook seu que cita o script como argumento (`node wrapper.mjs --target
// X/guarda.py`) continua seu. Hook sem script cai na comparação do JSON inteiro.
const SCRIPT_IN_CMD = /"([^"]+\.(?:py|mjs))"|'([^']+\.(?:py|mjs))'|([^\s"']+\.(?:py|mjs))(?![^\s"'])/i;

function hookIds(hook) {
  const home = os.homedir().replace(/\\/g, '/');
  const m = typeof hook?.command === 'string' ? hook.command.match(SCRIPT_IN_CMD) : null;
  const script = m ? m[1] || m[2] || m[3] : (Array.isArray(hook?.args) ? hook.args : []).find((a) => typeof a === 'string' && /\.(py|mjs)$/i.test(a));
  if (!script) return [JSON.stringify(hook)];
  const id = script.replace(/\\/g, '/').replace(/^(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%)(?=\/)/i, home);
  // Caminho do Windows não diferencia caixa: C:/Users e c:/users são o mesmo.
  return [/^[a-z]:\//i.test(id) ? id.toLowerCase() : id];
}

// Claude Code/Codex agrupam ({ matcher, hooks: [...] }); o Antigravity usa o hook solto.
const entryIds = (entry) => (Array.isArray(entry?.hooks) ? entry.hooks : [entry]).flatMap(hookIds);

// Tira todo hook que roda um dos `ids`; o grupo que fica vazio sai junto, e
// os hooks seus que dividiam o grupo ficam.
function withoutIds(entries, ids) {
  const hit = (h) => hookIds(h).some((id) => ids.includes(id));
  return entries.flatMap((c) => {
    if (!Array.isArray(c?.hooks)) return hit(c) ? [] : [c];
    const hooks = c.hooks.filter((h) => !hit(h));
    if (hooks.length === c.hooks.length) return [c];
    return hooks.length ? [{ ...c, hooks }] : [];
  });
}

// A entrada nova toma o lugar da primeira que rodava o mesmo script; as
// repetidas somem.
function upsert(current, entry) {
  const ids = entryIds(entry);
  const out = [];
  let placed = false;
  for (const c of current) {
    const [kept] = withoutIds([c], ids);
    if (kept === c) {
      out.push(c);
      continue;
    }
    if (kept) out.push(kept);
    if (!placed) out.push(entry);
    placed = true;
  }
  if (!placed) out.push(entry);
  return out;
}

const asList = (v) => (Array.isArray(v) ? v : []);

// Claude Code settings.json / Codex hooks.json shape:
//   { "<Event>": [{ matcher, hooks: [...] }] }
export function mergeHooks(existingHooks, snippetHooks) {
  const merged = { ...(existingHooks || {}) };
  for (const [event, entries] of Object.entries(snippetHooks || {})) {
    merged[event] = entries.reduce(upsert, asList(merged[event]));
  }
  return merged;
}

export function removeHooks(existingHooks, snippetHooks) {
  const result = { ...(existingHooks || {}) };
  for (const [event, entries] of Object.entries(snippetHooks || {})) {
    if (!Array.isArray(result[event])) continue;
    result[event] = withoutIds(result[event], entries.flatMap(entryIds));
    if (result[event].length === 0) delete result[event];
  }
  return result;
}

// Antigravity ~/.gemini/config/hooks.json shape:
//   { "<group>": { "<Event>": [...] } }
export function mergeAntigravityHooks(existing, snippetGroups) {
  const result = { ...(existing || {}) };
  for (const [group, events] of Object.entries(snippetGroups || {})) {
    if (isMetaKey(group) || !events || typeof events !== 'object' || Array.isArray(events)) continue;
    const currentGroup = { ...(result[group] || {}) };
    for (const [event, entries] of Object.entries(events)) {
      currentGroup[event] = entries.reduce(upsert, asList(currentGroup[event]));
    }
    result[group] = currentGroup;
  }
  return result;
}

export function removeAntigravityHooks(existing, snippetGroups) {
  const result = { ...(existing || {}) };
  for (const [group, events] of Object.entries(snippetGroups || {})) {
    if (isMetaKey(group) || !result[group] || typeof events !== 'object') continue;
    const currentGroup = { ...result[group] };
    for (const [event, entries] of Object.entries(events)) {
      if (!Array.isArray(currentGroup[event])) continue;
      currentGroup[event] = withoutIds(currentGroup[event], entries.flatMap(entryIds));
      if (currentGroup[event].length === 0) delete currentGroup[event];
    }
    if (Object.keys(currentGroup).length === 0) delete result[group];
    else result[group] = currentGroup;
  }
  return result;
}

export function resolveHomePlaceholder(snippet, home) {
  return JSON.parse(JSON.stringify(snippet).replaceAll('<HOME>', home.replace(/\\/g, '\\\\')));
}

export function stripMetaKeys(obj) {
  return Object.fromEntries(Object.entries(obj || {}).filter(([k]) => !isMetaKey(k)));
}

// ---------------------------------------------------------------- aim-guard
// O grupo "ai-memory" do ~/.gemini/config/hooks.json é escrito pelo instalador
// do próprio ai-memory. Cada comando simples dele ganha o prefixo
//   node "<hooks>/aim-guard.mjs" --
// que pula a captura quando MURI_AIM_NOCAPTURE=1 (chamadas headless do
// muri-saver). Comando com sintaxe de shell, ou que já tem guarda, fica como está.

const SHELL_SYNTAX = /[|&;<>`]|\$\(/;

export function guardPrefix(guardPath) {
  return `node "${guardPath}" -- `;
}

function mapCommands(group, fn) {
  const out = {};
  for (const [event, entries] of Object.entries(group || {})) {
    out[event] = Array.isArray(entries) ? entries.map((e) => {
      if (Array.isArray(e?.hooks)) return { ...e, hooks: e.hooks.map((h) => (typeof h?.command === 'string' ? { ...h, command: fn(h.command) } : h)) };
      return typeof e?.command === 'string' ? { ...e, command: fn(e.command) } : e;
    }) : entries;
  }
  return out;
}

export function guardAiMemoryHooks(existing, guardPath, group = 'ai-memory') {
  if (!existing?.[group]) return existing;
  const prefix = guardPrefix(guardPath);
  const wrap = (cmd) => {
    if (cmd.startsWith(prefix) || cmd.includes('aim-guard.mjs') || cmd.includes('MURI_AIM_NOCAPTURE') || SHELL_SYNTAX.test(cmd)) return cmd;
    return `${prefix}${cmd}`;
  };
  return { ...existing, [group]: mapCommands(existing[group], wrap) };
}

export function unguardAiMemoryHooks(existing, guardPath, group = 'ai-memory') {
  if (!existing?.[group]) return existing;
  const prefix = guardPrefix(guardPath);
  return { ...existing, [group]: mapCommands(existing[group], (cmd) => (cmd.startsWith(prefix) ? cmd.slice(prefix.length) : cmd)) };
}
