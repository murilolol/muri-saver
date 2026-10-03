#!/usr/bin/env node
// Hook SessionStart: garante o servidor local do ai-memory de pé antes que o
// SessionStart do próprio ai-memory (instalado por `ai-memory install-hooks`)
// busque o handoff. Sobe sob demanda, por sessão, em vez de no login.
//
// Se o muri-saver.json usa a cadeia de LLMs no ai-memory (llm.shim = true),
// também garante o shim (scripts/ai-memory-llm-shim.mjs) de pé. É o caminho
// que funciona em qualquer SO; onde existe agendador (launchd/systemd/Tarefas)
// o `muri-saver jobs install` registra o shim como serviço também.
//
// Nunca bloqueia nem falha a sessão: qualquer erro aqui é engolido.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import {
  AI_MEMORY_HOST, AI_MEMORY_PORT, SCRIPTS_DIR, loadConfig, bin, tcpUp, shimPort,
} from './muri-common.mjs';

function startDetached(cmd, args) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

// project_strategy=repo-root separa as observações pelo cwd. Abrir o agente
// direto na home (e depois /add-dir num projeto) nunca muda o cwd do processo,
// então tudo cai num projeto genérico. Avisa o agente pra ele avisar o usuário.
function warnIfHomeDir() {
  try {
    const cwd = process.cwd().replace(/[\\/]+$/, '').toLowerCase();
    const home = os.homedir().replace(/[\\/]+$/, '').toLowerCase();
    if (home && cwd === home) {
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext:
            `ai-memory: esta sessão começou na home (${os.homedir()}), não dentro de um projeto. `
            + 'Com project_strategy=repo-root, todas as observações vão para um projeto genérico em vez do '
            + 'projeto real, mesmo depois de /add-dir. Sugira ao usuário reabrir com `cd <projeto>` antes de iniciar o agente.',
        },
      }));
    }
  } catch {
    // best-effort
  }
}

async function main() {
  const cfg = loadConfig();
  try {
    if (!(await tcpUp(AI_MEMORY_PORT, AI_MEMORY_HOST))) {
      const aim = bin('ai-memory');
      if (aim) startDetached(aim.cmd, [...aim.pre, 'serve', '--transport', 'http', '--bind', `${AI_MEMORY_HOST}:${AI_MEMORY_PORT}`, '--enable-web']);
    }
  } catch {
    // nunca quebra o início da sessão
  }
  try {
    const shim = join(SCRIPTS_DIR, 'ai-memory-llm-shim.mjs');
    if (cfg.llm?.shim && existsSync(shim) && !(await tcpUp(shimPort(cfg)))) startDetached(process.execPath, [shim]);
  } catch {
    // idem
  }
  warnIfHomeDir();
  process.exit(0);
}

main();
