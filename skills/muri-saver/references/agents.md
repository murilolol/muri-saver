# Agent adapters

Detect the host and actual capabilities. Tool names and model availability
change; do not copy one provider's names into another provider's instructions.

| Host | Global instructions | Native questions | Limits and continuity |
|---|---|---|---|
| Codex | `~/.codex/AGENTS.md` and applicable project instructions | Available `request_user_input` or async question tool, respecting its mode | Use account-limit tools when exposed; use supported session/compaction controls |
| Claude Code | `~/.claude/CLAUDE.md` and project `CLAUDE.md` | `AskUserQuestion` when exposed | Status line or installed usage script may be cached; supported `/compact` and `/clear` |
| Antigravity/Gemini | Host-specific `GEMINI.md` | Available host question tool | Use host-supported usage/session controls; do not assume Claude commands |

Suggest a cheaper supported model for simple work when useful; the user or
host selects it. Do not invent model aliases, tool parameters or automatic
model switching. Subagents inherit permissions and current project scope.

## Hooks and optional setup

- The Codex Obsidian hook uses local I/O without a model. Its ai-memory Stop
  hook is separate and talks to a local HTTP service. Neither guarantees the
  latency of the other.
- Claude/Antigravity use the shared vault hook. Model enrichment, when enabled,
  has its own timeout and local fallback. Check configuration before claiming
  that an exit is entirely model-free.
- Installation, diagnosis and transcript import are deterministic commands;
  do not perform recurring manual copies or extra model summaries.
- Respect a configured vault/timezone. Public installs can omit Obsidian;
  an existing personal setup may require it. Preserve hooks, MCP entries,
  personal rules and data. Use installer dry-run before a setup change.

See the repository's INSTALL.md and docs/ai-memory-obsidian-setup.md for setup.
Read setup documentation only for installation or repair work.
