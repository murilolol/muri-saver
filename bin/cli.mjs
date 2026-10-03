#!/usr/bin/env node
// Entrada única do `npx muri-saver <comando>`. Os comandos de instalação e
// diagnóstico são os scripts de bin/; os de operação (jobs, llm, delegate...)
// rodam a cópia INSTALADA em ~/.claude/scripts quando ela existe, para que um
// job registrado pelo `npx` não aponte para uma pasta temporária.

import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPackageVersion, readConfig, configPath } from '../lib/config.mjs';

const BIN_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(BIN_DIR);

const COMMANDS = {
  install: { bin: 'install.mjs', args: [], help: 'instala/reinstala skill, hooks, governança (e jobs, com --with-jobs)' },
  update: { bin: 'install.mjs', args: ['--update'], help: 'reinstala reaproveitando o muri-saver.json salvo' },
  uninstall: { bin: 'install.mjs', args: ['--uninstall'], help: 'remove o que foi instalado (mantém o que você editou)' },
  doctor: { bin: 'doctor.mjs', args: [], help: 'verifica o ambiente inteiro (100% leitura)' },
  audit: { bin: 'audit.mjs', args: [], help: 'audita consumo observado e repetição de ferramentas, localmente' },
  ingest: { bin: 'ingest-sessions.mjs', args: [], help: 'importa sessões antigas de cada agente pro vault/ai-memory' },
  jobs: { script: 'muri-jobs.mjs', help: 'jobs de fundo: list | status | install <job...> | remove <job...> | run <job>' },
  llm: { script: 'ai-memory-llm-mode.mjs', help: 'provedor do ai-memory: chain | gemini | anthropic | off | status | tune' },
  delegate: { script: 'muri-delegate.mjs', help: 'delega uma tarefa pro Gemini (agy) ou Codex: delegate <gemini|codex> "<brief>"' },
  report: { script: 'muri-economy-report.py', python: true, help: 'relatório de economia (--days N, --save, --snapshot)' },
  reprocess: { script: 'ai-memory-reprocess-parked.mjs', help: 'reprocessa sessões estacionadas do ai-memory (--scan, --limit N)' },
  backfill: { script: 'vault-backfill.mjs', help: 'gera narrativa pras notas antigas do vault (--dry-run, --since)' },
  'finalize-idle': { script: 'ai-memory-finalize-idle.mjs', help: 'encerra sessões ociosas no ai-memory (--dry-run)' },
};

function usage() {
  const rows = Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(14)} ${c.help}`).join('\n');
  console.log(`muri-saver ${readPackageVersion(REPO_ROOT)}

Uso: muri-saver <comando> [opções]

Comandos:
${rows}

Cada comando aceita --help pra ver as próprias opções. Ex:
  npx muri-saver install --alias mendes-saver --with-all --with-jobs
  npx muri-saver llm chain
  npx muri-saver jobs status
`);
}

function scriptPath(name) {
  const cfg = readConfig(configPath({}));
  const claudeDir = cfg?.paths?.claudeDir || join(os.homedir(), '.claude');
  const installed = join(claudeDir, 'scripts', name);
  return existsSync(installed) ? installed : join(REPO_ROOT, 'scripts', name);
}

function python() {
  const names = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  return names.find((n) => spawnSync(n, ['--version'], { stdio: 'ignore', windowsHide: true }).status === 0) || null;
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || ['help', '--help', '-h'].includes(cmd)) {
  usage();
} else if (['--version', '-v', 'version'].includes(cmd)) {
  console.log(readPackageVersion(REPO_ROOT));
} else if (!COMMANDS[cmd]) {
  console.error(`Comando desconhecido: ${cmd}\n`);
  usage();
  process.exitCode = 1;
} else if (COMMANDS[cmd].bin) {
  const { bin, args } = COMMANDS[cmd];
  const path = join(BIN_DIR, bin);
  process.argv = [process.argv[0], path, ...args, ...rest];
  await import(pathToFileURL(path).href);
} else {
  const c = COMMANDS[cmd];
  const interp = c.python ? python() : process.execPath;
  if (!interp) {
    console.error('Python 3 não encontrado no PATH (o relatório de economia é um script Python).');
    process.exitCode = 1;
  } else {
    const r = spawnSync(interp, [scriptPath(c.script), ...rest], { stdio: 'inherit', windowsHide: true });
    process.exitCode = r.status ?? 1;
  }
}
