const SECRET_PATTERNS = [
  { re: /sk-ant-[A-Za-z0-9_-]{10,}/g, label: 'ANTHROPIC_KEY' },
  { re: /sk-proj-[A-Za-z0-9_-]{10,}/g, label: 'OPENAI_PROJECT_KEY' },
  { re: /\bsk-[A-Za-z0-9]{20,}\b/g, label: 'API_KEY' },
  { re: /gh[pousr]_[A-Za-z0-9]{20,}/g, label: 'GITHUB_TOKEN' },
  { re: /github_pat_[A-Za-z0-9_]{20,}/g, label: 'GITHUB_TOKEN' },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/g, label: 'SLACK_TOKEN' },
  { re: /AKIA[0-9A-Z]{16}/g, label: 'AWS_ACCESS_KEY_ID' },
  { re: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/g, label: 'AWS_SECRET_ACCESS_KEY' },
  { re: /AIza[0-9A-Za-z_-]{35}/g, label: 'GOOGLE_API_KEY' },
  { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, label: 'JWT' },
  { re: /Bearer\s+[A-Za-z0-9._-]{20,}/g, label: 'BEARER_TOKEN' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, label: 'PRIVATE_KEY' },
  { re: /(?:senha|password|passwd)\s*[:=]\s*['"]?\S{6,}['"]?/gi, label: 'PASSWORD' },
];

export function maskSecrets(text) {
  if (!text) return text;
  let out = String(text);
  for (const { re, label } of SECRET_PATTERNS) out = out.replace(re, `[REDACTED:${label}]`);
  return out;
}

// Pure metadata blocks are dropped with their content; wrappers like
// <USER_REQUEST> keep the inner text, which is the user's actual prompt.
const DROP_BLOCKS_RE = /<(ADDITIONAL_METADATA|SYSTEM_MESSAGE|system-reminder|local-command-caveat|CONTEXT_SUMMARY)>[\s\S]*?<\/\1>/g;
const SYSTEM_TAGS_RE = /<\/?(?:USER_REQUEST|ADDITIONAL_METADATA|CONTEXT_SUMMARY|SYSTEM_MESSAGE|PLAN|local-command-caveat|local-command-stdout|command-name|command-message|command-args|system-reminder)>/g;

export function stripSystemTags(text) {
  if (!text) return text;
  return String(text).replace(DROP_BLOCKS_RE, '').replace(SYSTEM_TAGS_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

// Same technique hooks/obsidian-vault-check.mjs uses in production: an
// unbalanced <div> would otherwise swallow the rest of the Obsidian note.
export function escapeStrayHtml(text) {
  if (!text) return '';
  return String(text).replace(/<\/?[a-zA-Z][^>]*>/g, (m) => `\`${m}\``);
}

export function sanitize(text) {
  return escapeStrayHtml(stripSystemTags(maskSecrets(text)));
}

// Titles come from the user's first real prompt; an unquoted ":" would be
// parsed as a nested YAML mapping and break the note's frontmatter.
export function yamlQuote(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
}
