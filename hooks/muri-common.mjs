// Código compartilhado pelos hooks (~/.claude/hooks) e pelos scripts de fundo
// (~/.claude/scripts, que importam ../hooks/muri-common.mjs). O instalador copia
// hooks/ e scripts/ lado a lado, então o import relativo vale no repo e na
// instalação. Sem dependências: só módulos do Node.
//
// Tudo aqui é best-effort: nenhuma função lança por causa de config ausente,
// binário ausente ou ai-memory fora do ar.

import { readFileSync, existsSync, readdirSync, statSync, realpathSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname, delimiter, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';

export const HOOKS_DIR = dirname(fileURLToPath(import.meta.url));
export const CLAUDE_DIR = dirname(HOOKS_DIR);
export const SCRIPTS_DIR = join(CLAUDE_DIR, 'scripts');

// Logs e estado: na instalação (pasta com settings.json ou muri-saver.json),
// ao lado dos hooks/scripts; rodando de um checkout do repo (testes, npx),
// em ~/.claude, pra nunca sujar o repositório.
const INSTALLED = existsSync(join(CLAUDE_DIR, 'settings.json')) || existsSync(join(CLAUDE_DIR, 'muri-saver.json'));
export const RUNTIME_DIR = process.env.MURI_SAVER_RUNTIME_DIR || (INSTALLED ? HOOKS_DIR : join(os.homedir(), '.claude', 'hooks'));
export const RUNTIME_SCRIPTS_DIR = process.env.MURI_SAVER_RUNTIME_SCRIPTS_DIR || (INSTALLED ? SCRIPTS_DIR : join(os.homedir(), '.claude', 'scripts'));
export const STATE_DIR = process.env.MURI_SAVER_STATE_DIR || join(RUNTIME_DIR, '.vault-state');
export const IS_WINDOWS = process.platform === 'win32';

export const AI_MEMORY_HOST = '127.0.0.1';
export const AI_MEMORY_PORT = 49374;
export const DEFAULT_SHIM_PORT = 49380;

// Variáveis que marcam um processo filho como "trabalho automático do
// muri-saver", não sessão do usuário: o hook do vault não cria nota pra ele,
// o muri-delegate recusa delegar de novo e os hooks do ai-memory (com o
// aim-guard) não capturam a execução.
export const CHILD_ENV = { MURI_SAVER_OBSIDIAN_GEN: '1', MURI_DELEGATE: '1', MURI_AIM_NOCAPTURE: '1' };

// ------------------------------------------------------------------ config

export function expandHome(p) {
  if (!p || typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(os.homedir(), p.slice(2));
  return p;
}

let cachedConfig = null;
export function loadConfig() {
  if (cachedConfig) return cachedConfig;
  const candidates = [
    process.env.MURI_SAVER_CONFIG,
    join(CLAUDE_DIR, 'muri-saver.json'),
    join(os.homedir(), '.claude', 'muri-saver.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      cachedConfig = JSON.parse(readFileSync(p, 'utf8'));
      return cachedConfig;
    } catch {
      // tenta o próximo
    }
  }
  cachedConfig = {};
  return cachedConfig;
}

// null = Obsidian desativado (instalação sem --vault). Sem config nenhuma,
// instalações antigas continuam usando ~/Documents/Obsidian Vault.
export function resolveVault(cfg = loadConfig()) {
  if (process.env.OBSIDIAN_VAULT) return expandHome(process.env.OBSIDIAN_VAULT);
  if (Object.hasOwn(cfg, 'vault')) return cfg.vault ? expandHome(cfg.vault) : null;
  return join(os.homedir(), 'Documents', 'Obsidian Vault');
}

export function validTimezone(tz) {
  try {
    return Boolean(tz) && Boolean(new Intl.DateTimeFormat('en-US', { timeZone: tz }));
  } catch {
    return false;
  }
}

export function resolveTimezone(cfg = loadConfig()) {
  return [process.env.MURI_SAVER_TZ, cfg.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone]
    .find(validTimezone) || 'UTC';
}

// MURI_SAVER_NOW fixa o relógio nos testes.
export function now() {
  const fixed = process.env.MURI_SAVER_NOW;
  return fixed && !Number.isNaN(Date.parse(fixed)) ? new Date(fixed) : new Date();
}

export function dateString(d = now(), tz = resolveTimezone()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function timeString(d = now(), tz = resolveTimezone()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.hour}h${v.minute}`;
}

// ------------------------------------------------------------------ sanitização
// Mesma lista de lib/sanitize.mjs (os hooks não importam lib/, que fica no repo).

const SECRET_PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{10,}/g, 'ANTHROPIC_KEY'],
  [/sk-proj-[A-Za-z0-9_-]{10,}/g, 'OPENAI_PROJECT_KEY'],
  [/\bsk-[A-Za-z0-9]{20,}\b/g, 'API_KEY'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, 'GITHUB_TOKEN'],
  [/github_pat_[A-Za-z0-9_]{20,}/g, 'GITHUB_TOKEN'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, 'SLACK_TOKEN'],
  [/AKIA[0-9A-Z]{16}/g, 'AWS_ACCESS_KEY_ID'],
  [/(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/g, 'AWS_SECRET_ACCESS_KEY'],
  [/AIza[0-9A-Za-z_-]{35}/g, 'GOOGLE_API_KEY'],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'JWT'],
  [/Bearer\s+[A-Za-z0-9._-]{20,}/g, 'BEARER_TOKEN'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, 'PRIVATE_KEY'],
  [/(?:senha|password|passwd)\s*[:=]\s*['"]?\S{6,}['"]?/gi, 'PASSWORD'],
];
const DROP_BLOCKS_RE = /<(ADDITIONAL_METADATA|SYSTEM_MESSAGE|system-reminder|local-command-caveat|CONTEXT_SUMMARY)>[\s\S]*?<\/\1>/g;
const SYSTEM_TAGS_RE = /<\/?(?:USER_REQUEST|ADDITIONAL_METADATA|CONTEXT_SUMMARY|SYSTEM_MESSAGE|PLAN|local-command-caveat|local-command-stdout|command-name|command-message|command-args|system-reminder)>/g;

export function maskSecrets(text) {
  let out = String(text ?? '');
  for (const [re, label] of SECRET_PATTERNS) out = out.replace(re, `[REDACTED:${label}]`);
  return out;
}

export function cleanText(text) {
  return maskSecrets(text).replace(DROP_BLOCKS_RE, '').replace(SYSTEM_TAGS_RE, '');
}

// Tag HTML solta quebra a nota inteira no Obsidian: vira código inline.
export function escapeHtml(text) {
  return String(text ?? '').replace(/<\/?[a-zA-Z][^>]*>/g, (m) => `\`${m}\``);
}

export function sanitize(text) {
  return text ? escapeHtml(cleanText(text)) : '';
}

// Limpa antes de cortar: cortar texto cru pode partir um segredo ao meio.
export function excerpt(text, max) {
  const cleaned = cleanText(text).replace(/\s+/g, ' ').trim();
  const cut = cleaned.length > max ? `${cleaned.slice(0, max - 1).replace(/<[^>]*$/, '').trimEnd()}…` : cleaned;
  return escapeHtml(cut);
}

export function yamlQuote(text) {
  return `"${String(text ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
}

// ------------------------------------------------------------------ binários
// Resolve um CLI (agy, claude, codex, ai-memory) para { cmd, pre } que dá pra
// passar direto pro spawn sem shell. No Windows, os CLIs instalados pelo npm
// são shims .cmd, que o Node se recusa a executar sem shell:true (e o cmd.exe
// estraga argumento com quebra de linha). Então o shim é lido e o .js/.exe
// real por trás dele é chamado direto.

const EXTRA_DIRS = IS_WINDOWS
  ? [join(os.homedir(), '.cargo', 'bin'), join(os.homedir(), 'AppData', 'Roaming', 'npm'), join(os.homedir(), '.local', 'bin')]
  : [join(os.homedir(), '.local', 'bin'), join(os.homedir(), '.cargo', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function searchDirs() {
  const fromPath = (process.env.PATH || process.env.Path || '').split(delimiter).filter(Boolean);
  return [...new Set([...fromPath, ...EXTRA_DIRS])];
}

function fromScriptPath(p) {
  return /\.(mjs|cjs|js)$/i.test(p) ? { cmd: process.execPath, pre: [p] } : { cmd: p, pre: [] };
}

function parseNpmCmdShim(cmdPath) {
  try {
    const text = readFileSync(cmdPath, 'utf8');
    const m = text.match(/"%(?:~)?dp0%\\?([^"]+?\.(?:js|mjs|cjs|exe))"/i);
    if (!m) return null;
    const target = join(dirname(cmdPath), m[1].replace(/\\/g, '/'));
    return existsSync(target) ? fromScriptPath(target) : null;
  } catch {
    return null;
  }
}

const binCache = new Map();
export function resolveBin(name, envVar) {
  const override = envVar && process.env[envVar];
  if (override) return fromScriptPath(expandHome(override));
  if (binCache.has(name)) return binCache.get(name);
  let found = null;
  if (isAbsolute(name)) {
    found = isFile(name) ? fromScriptPath(name) : null;
  } else {
    for (const dir of searchDirs()) {
      if (IS_WINDOWS) {
        const exe = join(dir, `${name}.exe`);
        if (isFile(exe)) { found = { cmd: exe, pre: [] }; break; }
        const cmd = join(dir, `${name}.cmd`);
        if (isFile(cmd)) { found = parseNpmCmdShim(cmd); if (found) break; }
      } else {
        const p = join(dir, name);
        if (isFile(p)) { found = { cmd: p, pre: [] }; break; }
      }
    }
  }
  binCache.set(name, found);
  return found;
}

export const BIN_ENV = {
  'ai-memory': 'MURI_SAVER_AI_MEMORY_BIN',
  agy: 'MURI_SAVER_AGY_BIN',
  claude: 'MURI_SAVER_CLAUDE_BIN',
  codex: 'MURI_SAVER_CODEX_BIN',
};

export function bin(name) {
  return resolveBin(name, BIN_ENV[name]);
}

// ------------------------------------------------------------------ rede

export function tcpUp(port, host = '127.0.0.1', timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

export function shimPort(cfg = loadConfig()) {
  return Number(process.env.AIM_SHIM_PORT || cfg.llm?.shimPort || DEFAULT_SHIM_PORT);
}

// ------------------------------------------------------------------ ai-memory

// `ai-memory status --json` devolve data_dir e db_path no caminho certo de
// cada SO (Library/Application Support no macOS, ~/.local/share no Linux,
// AppData no Windows). Fallback: o padrão de cada SO.
let cachedAim = null;
export function aiMemoryPaths() {
  if (cachedAim) return cachedAim;
  const exe = bin('ai-memory');
  if (exe) {
    try {
      const out = execFileSync(exe.cmd, [...exe.pre, 'status', '--json'], {
        encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
      });
      const d = JSON.parse(out);
      if (d.data_dir) {
        cachedAim = { dataDir: d.data_dir, dbPath: d.db_path || join(d.data_dir, 'db', 'memory.sqlite') };
        return cachedAim;
      }
    } catch {
      // servidor/binário com problema: usa o padrão do SO
    }
  }
  const home = os.homedir();
  const dataDir = process.platform === 'darwin'
    ? join(home, 'Library', 'Application Support', 'ai-memory')
    : IS_WINDOWS
      ? join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'ai-memory')
      : join(process.env.XDG_DATA_HOME || join(home, '.local', 'share'), 'ai-memory');
  cachedAim = { dataDir, dbPath: join(dataDir, 'db', 'memory.sqlite') };
  return cachedAim;
}

// Consulta read-only no SQLite do ai-memory. Usa node:sqlite (Node >= 22.5)
// e cai pro binário sqlite3 quando ele existe. Devolve null se nenhum dos dois.
export async function sqliteQuery(dbPath, sql) {
  if (!existsSync(dbPath)) return null;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return db.prepare(sql).all();
    } finally {
      db.close();
    }
  } catch {
    // sem node:sqlite: tenta o CLI
  }
  const sqlite = resolveBin('sqlite3', 'MURI_SAVER_SQLITE_BIN');
  if (!sqlite) return null;
  try {
    const out = execFileSync(sqlite.cmd, [...sqlite.pre, '-readonly', '-json', dbPath, sql], {
      encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
    });
    return out.trim() ? JSON.parse(out) : [];
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ util

// Anexa uma linha a um log, criando a pasta (numa home nova ~/.claude/hooks pode não existir).
export function appendLog(path, line) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, line.endsWith('\n') ? line : `${line}\n`);
  } catch {
    // log nunca derruba quem chamou
  }
}

// O arquivo foi executado direto (node arquivo.mjs) ou só importado?
export function isMain(metaUrl) {
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

export function listDirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function readJsonSafe(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}
