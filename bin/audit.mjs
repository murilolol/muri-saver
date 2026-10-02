#!/usr/bin/env node
import os from 'node:os';
import { accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import { auditInstructions, auditSession } from '../lib/audit.mjs';
import { discoverAgent } from '../lib/parsers.mjs';

const HELP = `Usage: muri-saver audit [options]

Local, read-only audit. No LLM, network calls or writes.
  --file <path>          One JSONL transcript (agent auto-detected).
  --agent <name>         claude | codex | antigravity | all (default: all).
  --limit <N>            Latest N sessions in total (default: 5).
  --instructions-only    Measure global instruction files, no transcripts.
  --source-home <path>   Audit a backup home instead of the current user.
  --json                 Structured report; no prompts or tool arguments.
  --help                 This help.

Examples:
  muri-saver audit --agent claude --limit 3
  muri-saver audit --file ./session.jsonl --json
  muri-saver audit --instructions-only
`;

try {
  const args = { agent: 'all', limit: 5, home: os.homedir(), file: null, instructionsOnly: false, json: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (['--help', '-h'].includes(flag)) { console.log(HELP); process.exit(0); }
    if (flag === '--json') args.json = true;
    else if (flag === '--instructions-only') args.instructionsOnly = true;
    else if (['--file', '--agent', '--limit', '--source-home'].includes(flag)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      if (flag === '--file') args.file = resolve(value);
      if (flag === '--agent') args.agent = value;
      if (flag === '--source-home') args.home = resolve(value);
      if (flag === '--limit') args.limit = Number(value);
    } else throw new Error('Unknown option (use --help)');
  }
  if (!['all', 'claude', 'codex', 'antigravity'].includes(args.agent)) throw new Error('Invalid --agent');
  if (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 100) throw new Error('--limit must be an integer from 1 to 100');
  if (args.file && args.instructionsOnly) throw new Error('Choose --file or --instructions-only');
  const report = {
    schemaVersion: 1,
    notes: [
      'Observed usage only; missing counters are unknown, not zero. No price or account-quota estimate is made.',
      'Cached input is included in input. Claude cache creation is also included in input; Codex reasoning is included in output.',
      'If Claude cache counters are missing, inputComplete=false and observed input/total are partial.',
      'Identical tool arguments within an edit-free interval are review signals, not proof of waste. Arguments are hashed and never printed.',
      'No prompt text, tool arguments, instruction content or credentials are exported. Report paths and tool names may still be private; review before sharing.',
    ],
    instructions: auditInstructions(args.home), sessions: [], skippedSubagents: 0, skippedSqlite: 0,
  };
  let refs = [];
  if (!args.instructionsOnly) {
    if (args.file) {
      accessSync(args.file, constants.R_OK);
      refs = [{ agent: args.agent === 'all' ? 'auto' : args.agent, sourcePaths: [args.file] }];
    } else {
      const agents = args.agent === 'all' ? ['claude', 'codex', 'antigravity'] : [args.agent];
      for (const agent of agents) {
        const found = await discoverAgent(agent, args.home);
        report.skippedSubagents += found.skippedSubagents || 0;
        report.skippedSqlite += found.refs.filter((ref) => ref.kind === 'codex-sqlite').length;
        refs.push(...found.refs.filter((ref) => ref.kind !== 'codex-sqlite'));
      }
      refs.sort((a, b) => b.mtimeMs - a.mtimeMs);
      refs = refs.slice(0, args.limit);
    }
    for (const ref of refs) report.sessions.push(await auditSession(ref.sourcePaths[0], { agent: ref.agent, home: args.home }));
  }
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`muri-saver audit — ${report.sessions.length} session(s), local and read-only`);
    for (const file of report.instructions.files) console.log(`  ${file.path}: ${file.bytes} bytes / ${file.words} words`);
    for (const group of report.instructions.duplicates) console.log(`  Identical instructions: ${group.join(', ')}`);
    console.log(report.instructions.note);
    for (const session of report.sessions) {
      console.log(`\n${session.agent}: ${session.source}`);
      console.log(session.tokens ? `  Observed tokens: ${session.tokens.input} input (${session.tokens.cachedInput ?? 'unknown'} cached), ${session.tokens.output} output; ${session.tokens.total} total` : '  Tokens: unavailable in this transcript');
      if (session.tokens?.inputComplete === false) console.log('  Partial input/total: cache counters are missing.');
      console.log(`  Tools: ${session.toolCalls}; malformed lines: ${session.invalidLines}`);
      for (const repeat of session.repeatedCalls) console.log(`  Review: ${repeat.tool} ×${repeat.count}, lines ${repeat.lines.join(', ')}; signature ${repeat.fingerprint}`);
    }
    if (report.skippedSqlite) console.log(`Skipped ${report.skippedSqlite} SQLite-only thread(s); usage audit requires JSONL.`);
    if (!refs.length && !args.instructionsOnly) console.log('No supported JSONL sessions found. Use --file to audit a transcript.');
    for (const note of report.notes) console.log(`\n${note}`);
  }
} catch (error) {
  // Avoid printing raw input, filesystem paths or credential-bearing arguments.
  const safe = error.code ? `Cannot read audit source (${error.code})` : error.message;
  console.error(`audit: ${safe}`);
  process.exitCode = 1;
}
