import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import os from 'node:os';

export const DEFAULT_ALIAS = 'muri-saver';
export const CONFIG_FILENAME = 'muri-saver.json';

export function systemTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function defaultClaudeDir(home = os.homedir()) {
  return join(home, '.claude');
}

export function defaultVaultPath(home = os.homedir()) {
  return join(home, 'Documents', 'Obsidian Vault');
}

// Hooks and bin scripts all agree on one location so a vault/timezone chosen
// at install time is honored everywhere, including the standalone hooks.
export function configPath({ claudeDir, home = os.homedir(), env = process.env } = {}) {
  if (env.MURI_SAVER_CONFIG) return env.MURI_SAVER_CONFIG;
  return join(claudeDir || defaultClaudeDir(home), CONFIG_FILENAME);
}

export function readConfig(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function writeConfig(path, config) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function resolveVault({ cliVault, config, env = process.env, home = os.homedir() } = {}) {
  return cliVault || env.OBSIDIAN_VAULT || config?.vault || defaultVaultPath(home);
}

export function resolveTimezone({ cliTimezone, config, env = process.env } = {}) {
  const candidates = [cliTimezone, env.MURI_SAVER_TZ, config?.timezone, systemTimezone(), 'UTC'];
  return candidates.find((tz) => isValidTimezone(tz));
}

export function sha256File(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

export function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function readPackageVersion(repoRoot) {
  try {
    return JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}
