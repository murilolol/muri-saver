#!/usr/bin/env node
// Hook Notification: alerta no desktop quando o Claude Code está esperando você.
// Pula quando o terminal já avisa (o Orca exporta ORCA_PANE_KEY) ou com MURI_NOTIFY=0.
// shortcut: sem toast no Windows; adicionar via PowerShell se alguém pedir.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (process.env.MURI_NOTIFY !== '0' && !process.env.ORCA_PANE_KEY) {
  let msg = 'Claude está esperando você';
  try { msg = JSON.parse(readFileSync(0, 'utf8')).message || msg; } catch {}
  msg = msg.replace(/["\\]/g, '');
  if (process.platform === 'darwin') {
    spawnSync('osascript', ['-e', `display notification "${msg}" with title "Claude Code" sound name "Glass"`]);
  } else if (process.platform === 'linux') {
    spawnSync('notify-send', ['Claude Code', msg]);
  }
}
