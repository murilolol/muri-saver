# Agent adapters

Detect the host and its actual capabilities. Tool names and model
availability change; don't copy one provider's names into another's.

| Host | Global instructions | Native questions | Limits and continuity |
|---|---|---|---|
| Claude Code | `~/.claude/CLAUDE.md` + project `CLAUDE.md` | `AskUserQuestion` when exposed | Status line / usage script can be cached; `/compact`, `/clear` |
| Codex | `~/.codex/AGENTS.md` + project instructions | the host's question tool, respecting its mode | account-limit tool when exposed; new chat at a checkpoint |
| Antigravity | `~/.gemini/GEMINI.md` | the host's question tool | host usage view; no SessionEnd event |

Suggest a cheaper supported model for simple work; the user or host selects
it. Don't invent model aliases, tool parameters or automatic switching.

## What runs in the background (don't redo it by hand)

- **Vault (live note v2)**: the Stop hook writes a local dump of every session
  (no model, instant). For substantial sessions a detached worker writes an
  LLM narrative every N minutes (default 15) and once more at SessionEnd,
  using the `llm.narrative` model chain — by default the Google quota via
  `agy` or the Gemini API, never the Claude quota. Only the
  `<!-- auto-narrativa -->`/`<!-- auto-dump -->` blocks are regenerated.
- **Codex** uses the same pipeline (its hook only forwards the payload and the
  rollout is normalized). **Antigravity** has no SessionEnd: the
  `finalize-idle` job closes its idle sessions in ai-memory, and the vault
  narrative is copied into ai-memory because ai-memory only sees tool events
  from Antigravity.
- **ai-memory consolidation** can run through the muri-saver shim (OpenAI
  compatible, `127.0.0.1:49380`), which walks the `llm.aiMemory` chain and
  cools a model down on quota errors. Sessions parked while every model was
  out are retried by the `reprocess-parked` job.
- Headless runs started by muri-saver (narrative, shim, delegate) carry
  `MURI_DELEGATE=1`, `MURI_SAVER_OBSIDIAN_GEN=1` and `MURI_AIM_NOCAPTURE=1`, so
  they never become vault notes or ai-memory sessions.

## Setup and repair

Installation, diagnosis and import are deterministic commands:
`node bin/install.mjs --dry-run`, `node bin/doctor.mjs`,
`node bin/ingest-sessions.mjs --all --dry-run`. Respect a configured
vault/timezone; public installs can omit Obsidian. Preserve the user's hooks,
MCP entries, personal rules and data. Read setup docs (INSTALL.md,
docs/llm-chain.md, docs/background-jobs.md) only for installation or repair.
