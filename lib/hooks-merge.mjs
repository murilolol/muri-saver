import { isDeepStrictEqual } from 'node:util';

export const jsonEqual = (a, b) => isDeepStrictEqual(a, b);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function isMetaKey(key) {
  return key.startsWith('_comment') || key.startsWith('_nota');
}

// Claude Code settings.json / Codex hooks.json shape:
//   { "<Event>": [{ matcher, hooks: [...] }] }
export function mergeHooks(existingHooks, snippetHooks) {
  const merged = { ...(existingHooks || {}) };
  for (const [event, entries] of Object.entries(snippetHooks || {})) {
    const current = Array.isArray(merged[event]) ? merged[event] : [];
    const toAdd = entries.filter((e) => !current.some((c) => same(c, e)));
    merged[event] = [...current, ...toAdd];
  }
  return merged;
}

export function removeHooks(existingHooks, snippetHooks) {
  const result = { ...(existingHooks || {}) };
  for (const [event, entries] of Object.entries(snippetHooks || {})) {
    if (!Array.isArray(result[event])) continue;
    result[event] = result[event].filter((c) => !entries.some((e) => same(c, e)));
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
      const current = Array.isArray(currentGroup[event]) ? currentGroup[event] : [];
      const toAdd = entries.filter((e) => !current.some((c) => same(c, e)));
      currentGroup[event] = [...current, ...toAdd];
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
      currentGroup[event] = currentGroup[event].filter((c) => !entries.some((e) => same(c, e)));
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
