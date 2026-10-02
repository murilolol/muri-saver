# Local usage audit

[Português](./audit.md)

`audit` reports observed usage and tool-call repetition per session. It needs
Node ≥18 and makes no LLM/network calls or writes.

```bash
node bin/cli.mjs audit --instructions-only
node bin/cli.mjs audit --agent claude --limit 3
node bin/cli.mjs audit --file ./session.jsonl --json
```

Without `--file`, the command discovers local Claude Code, Codex and
Antigravity JSONL and reads the latest five sessions in total. `--limit` accepts
1–100; `--agent` selects a source; `--source-home` reads a backup. Known
subagents and SQLite-only Codex threads are skipped.

Reports include instruction-file bytes/words at standard paths, exact duplicate
files, observed tokens, tool counts and up to ten repeated-call groups. Arguments
are hashed, never printed; line numbers provide evidence. Recognized edits start
a new interval. Repetition is a review signal, not proof of waste.

Claude usage is counted once per message ID; input includes cache reads and
creation. Codex uses its final cumulative snapshot; cached input and reasoning
are not added twice. Antigravity tool calls are supported, but its usage counters
are unknown in this parser. Missing usage is unknown, not zero. Missing Claude
cache counters set `inputComplete=false`; observed input/total are then partial.

Bytes/words are not tokens; observed tokens are not prices or subscription
quota. Peak request input is not current context. Timestamp span is not active
work time. Custom aliases/paths may need a manual instruction comparison.
Malformed JSON lines are counted; unreadable sources fail explicitly.

No prompts, arguments or instruction text are exported. Paths and tool names
can still be private: review before sharing. Transcript formats may change.

For an A/B comparison, hold task, checkout, model/settings, tools and quality
criteria constant, use equivalent fresh sessions and repeat runs. Compare
correctness along with tokens/time and disclose cache differences. Historical
audits motivate these rules; they do not prove a savings percentage.
