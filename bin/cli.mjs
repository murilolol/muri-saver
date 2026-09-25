#!/usr/bin/env node
// Single entry point for `npx muri-saver <command>`; each command is one of
// the standalone scripts in bin/, which read their flags from process.argv.

import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPackageVersion } from '../lib/config.mjs';

const BIN_DIR = dirname(fileURLToPath(import.meta.url));

const COMMANDS = {
  install: { script: 'install.mjs', args: [], help: 'instala/reinstala skill, hooks e governança' },
  update: { script: 'install.mjs', args: ['--update'], help: 'reinstala reaproveitando o muri-saver.json salvo' },
  uninstall: { script: 'install.mjs', args: ['--uninstall'], help: 'remove o que foi instalado (mantém o que você editou)' },
  doctor: { script: 'doctor.mjs', args: [], help: 'verifica o ambiente inteiro (100% leitura)' },
  ingest: { script: 'ingest-sessions.mjs', args: [], help: 'importa sessões antigas de cada agente pro vault/ai-memory' },
};

function usage() {
  const rows = Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(10)} ${c.help}`).join('\n');
  console.log(`muri-saver ${readPackageVersion(dirname(BIN_DIR))}

Uso: muri-saver <comando> [opções]

Comandos:
${rows}

Cada comando aceita --help pra ver as próprias opções. Ex:
  npx muri-saver install --alias mendes-saver --with-all
  npx muri-saver ingest --all --dry-run
`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || ['help', '--help', '-h'].includes(cmd)) {
  usage();
} else if (['--version', '-v', 'version'].includes(cmd)) {
  console.log(readPackageVersion(dirname(BIN_DIR)));
} else if (!COMMANDS[cmd]) {
  console.error(`Comando desconhecido: ${cmd}\n`);
  usage();
  process.exitCode = 1;
} else {
  const { script, args } = COMMANDS[cmd];
  const scriptPath = join(BIN_DIR, script);
  process.argv = [process.argv[0], scriptPath, ...args, ...rest];
  await import(pathToFileURL(scriptPath).href);
}
