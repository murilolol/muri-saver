# Delegation with muri-delegate.mjs

`node ~/.claude/scripts/muri-delegate.mjs <gemini|codex> [options] "<brief>"`
(or `echo "<brief>" | ... -`). The delegate runs headless on **its own
quota**: `gemini` through the Antigravity CLI (`agy`, Gemini Flash by
default), `codex` through `codex exec` (real sandbox). Only a short answer
comes back into your context.

| Option | Meaning |
|---|---|
| `--write` | codex only: `workspace-write` sandbox; requires a clean `git status` |
| `--cd DIR` | working directory (default: current) |
| `--model M` | force a model (gemini: an `agy models` id; codex: `-m`) |
| `--effort E` | `low` / `medium` (default) / `high` |
| `--file F` | append a file to the brief (repeatable; logs, excerpts; 200 KB cap each) |
| `--lines N` | max lines returned (default 60) |
| `--timeout S` | kill after S seconds (default 900) |

Exit codes: `0` ok · `2` usage/precondition · `3` the delegate changed files
in a read-only task (the diff is printed) · `64` recursion refused ·
`75` the delegate's quota ran out → switch gemini↔codex or use a cheap
subagent · `142` timeout.

## Briefs

- **Self-contained**: goal, paths, constraints and what "done" means. The
  delegate can't see this conversation.
- **Don't delegate**: 1-2 tool calls of work, nuance that lives in this
  conversation, secrets or `.env` contents, destructive operations, production
  servers.
- `gemini` is read-only by contract: the script compares `git status` before
  and after and fails with exit 3 if anything changed.
- Writing only through `codex --write`: clean tree required, no commit. Review
  with `git diff --stat` and targeted excerpts, not by rereading whole files.
- Plan quota (5h window) at 75% or more → delegate more.
- With `MURI_DELEGATE=1` in the environment **you** are the delegate: don't
  delegate again (the script refuses with exit 64).

Every call is logged in `~/.claude/scripts/.delegations.log` (TSV: time,
agent, model, effort, mode, seconds, exit code, bytes returned, directory) and
shows up in the weekly economy report.
