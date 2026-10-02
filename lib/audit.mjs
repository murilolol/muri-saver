import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { maskSecrets } from './sanitize.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const number = (value) => Number.isFinite(value) && value >= 0 ? value : 0;
const label = (value) => maskSecrets(String(value)).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 120);

export function privatePath(path, home) {
  return label(home ? String(path).split(home).join('<HOME>') : path);
}

export function auditInstructions(home) {
  const candidates = [
    'AGENTS.md', '.codex/AGENTS.md', '.claude/CLAUDE.md', '.gemini/GEMINI.md',
    '.agents/skills/muri-saver/SKILL.md', '.claude/skills/muri-saver/SKILL.md',
    '.gemini/antigravity/skills/muri-saver/SKILL.md', '.gemini/skills/muri-saver/SKILL.md',
    '.codex/skills/muri-saver/SKILL.md',
  ];
  const files = [];
  const groups = new Map();
  for (const relative of candidates) {
    const path = join(home, relative);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    const hash = digest(text);
    const file = { path: privatePath(path, home), bytes: Buffer.byteLength(text), words: text.trim() ? text.trim().split(/\s+/).length : 0 };
    files.push(file);
    groups.set(hash, [...(groups.get(hash) || []), file.path]);
  }
  return {
    files,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    duplicates: [...groups.values()].filter((paths) => paths.length > 1),
    note: 'Bytes and words measure instruction size, not tokens. Loading depends on the agent and scope; files listed here are not necessarily loaded together.',
  };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

export async function auditSession(path, { agent = 'auto', home = '' } = {}) {
  const bytes = statSync(path).size;
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  // Forward filesystem failures; readline alone does not own stream errors.
  let streamError;
  input.on('error', (error) => { streamError = error; lines.close(); });
  const usageByMessage = new Map();
  const seenCalls = new Set();
  const calls = new Map();
  const tools = new Map();
  let cumulative = null;
  let epoch = 0;
  let records = 0;
  let invalidLines = 0;
  let peakRequestInput = null;
  let usageRecords = 0;
  let lineNumber = 0;
  let firstTime = null;
  let lastTime = null;

  function call(rawName, args, id) {
    if (!rawName || (id && seenCalls.has(id))) return;
    if (id) seenCalls.add(id);
    const name = label(rawName);
    tools.set(name, (tools.get(name) || 0) + 1);
    if (/(?:apply_patch|edit_file|editfile|replace_file|write_file|write_to_file|^write$|^edit$|multi_edit|multiedit)/i.test(name)) {
      epoch++;
      return;
    }
    let parsed = args;
    if (typeof args === 'string') {
      try { parsed = JSON.parse(args); } catch { /* hash opaque arguments */ }
    }
    const fingerprint = digest(JSON.stringify(stable(parsed ?? {})));
    const key = `${epoch}:${name}:${fingerprint}`;
    const current = calls.get(key) || { tool: name, fingerprint: fingerprint.slice(0, 12), count: 0, lines: [] };
    current.count++;
    if (current.lines.length < 5) current.lines.push(lineNumber);
    calls.set(key, current);
  }

  try {
    for await (const line of lines) {
      lineNumber++;
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { invalidLines++; continue; }
      if (!obj || typeof obj !== 'object') { invalidLines++; continue; }
      records++;
      const time = Date.parse(obj.timestamp || obj.created_at || '');
      if (Number.isFinite(time)) {
        firstTime = firstTime === null ? time : Math.min(firstTime, time);
        lastTime = lastTime === null ? time : Math.max(lastTime, time);
      }
      if (agent === 'auto') {
        if (['session_meta', 'response_item', 'event_msg'].includes(obj.type)) agent = 'codex';
        else if (['USER_INPUT', 'PLANNER_RESPONSE'].includes(obj.type)) agent = 'antigravity';
        else if (obj.message && ['user', 'assistant'].includes(obj.type)) agent = 'claude';
      }
      if (agent === 'claude' && obj.type === 'assistant' && !obj.isSidechain && !obj.isMeta) {
        const message = obj.message || {};
        if (message.usage && Number.isFinite(message.usage.input_tokens) && Number.isFinite(message.usage.output_tokens)) {
          usageRecords++;
          const usage = message.usage;
          const inputTokens = number(usage.input_tokens) + number(usage.cache_read_input_tokens) + number(usage.cache_creation_input_tokens);
          usageByMessage.set(message.id || `line-${lineNumber}`, {
            input: inputTokens, cachedInput: Number.isFinite(usage.cache_read_input_tokens) ? number(usage.cache_read_input_tokens) : null,
            cacheCreation: Number.isFinite(usage.cache_creation_input_tokens) ? number(usage.cache_creation_input_tokens) : null, output: number(usage.output_tokens),
          });
          peakRequestInput = Math.max(peakRequestInput || 0, inputTokens);
        }
        for (const block of Array.isArray(message.content) ? message.content : []) {
          if (block?.type === 'tool_use') call(block.name, block.input, block.id);
        }
      } else if (agent === 'codex') {
        const payload = obj.payload || {};
        if (obj.type === 'event_msg' && payload.type === 'token_count') {
          const usage = payload.info?.total_token_usage;
          if (usage && Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens)) {
            usageRecords++;
            cumulative = {
              input: number(usage.input_tokens), cachedInput: Number.isFinite(usage.cached_input_tokens) ? number(usage.cached_input_tokens) : null,
              cacheCreation: null, output: number(usage.output_tokens),
              total: Number.isFinite(usage.total_tokens) ? number(usage.total_tokens) : number(usage.input_tokens) + number(usage.output_tokens),
              source: 'codex-cumulative-usage',
              inputComplete: true,
            };
          }
          const request = payload.info?.last_token_usage?.input_tokens;
          if (Number.isFinite(request)) peakRequestInput = Math.max(peakRequestInput || 0, number(request));
        }
        if (obj.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(payload.type)) {
          call(payload.name, payload.arguments ?? payload.input, payload.call_id);
        }
      } else if (agent === 'antigravity') {
        for (const tool of Array.isArray(obj.tool_calls) ? obj.tool_calls : []) call(tool?.name, tool?.args, tool?.id);
      }
    }
    if (streamError) throw streamError;
  } finally {
    lines.close();
    input.destroy();
  }

  let tokens = cumulative;
  if (usageByMessage.size) {
    const sum = { input: 0, cachedInput: 0, cacheCreation: 0, output: 0 };
    for (const usage of usageByMessage.values()) {
      for (const key of Object.keys(sum)) {
        if (sum[key] === null || usage[key] === null) sum[key] = null;
        else sum[key] += usage[key];
      }
    }
    tokens = { ...sum, total: sum.input + sum.output, source: 'claude-message-usage', inputComplete: sum.cachedInput !== null && sum.cacheCreation !== null };
  }
  return {
    source: privatePath(path, home), agent, bytes, records, invalidLines,
    observedSpanSeconds: firstTime === null ? null : (lastTime - firstTime) / 1000,
    tokens, usageRecords, usageMessages: usageByMessage.size || null, peakRequestInput,
    toolCalls: [...tools.values()].reduce((sum, count) => sum + count, 0),
    tools: Object.fromEntries([...tools].sort((a, b) => b[1] - a[1])),
    repeatedCalls: [...calls.values()].filter((entry) => entry.count > 1).sort((a, b) => b.count - a.count).slice(0, 10),
  };
}
