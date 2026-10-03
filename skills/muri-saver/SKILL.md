---
name: muri-saver
description: Aggressive saving mode for tokens, cost and plan limits (5h/weekly) in coding-agent work. Activate on "muri saver", "muri-saver", "/muri-saver" or an explicit request to save tokens/cost/context/limits; stays active until the user turns it off.
---

# muri-saver (3.1)

Sticky mode: valid for the whole conversation after activation. Don't reload
this skill on repeated mentions. It ends only on "sair do muri-saver",
"desativar muri-saver" or an explicit request to turn it off. Keep the user's
language. The global instructions (CLAUDE.md/AGENTS.md/GEMINI.md) already
cover memory-first, automatic session capture, context vs. quota and logs —
apply them, don't repeat them.

The real cost drivers found by auditing real transcripts: **marathon
sessions** (one ran 42h / 7,059 messages), **rereading the same file** (up to
54× in a session), **high effort for everything**, **screenshots instead of
page text** (501 × 3) and **reloading tool schemas**. An expensive model is
<1% of the problem. On activation, classify the task (profiles below) and
apply them together with the universal rules.

## Universal rules

- **Answers**: no preamble, no recap, close in 1-2 sentences. Don't repeat
  code or output already shown. Don't offer options nobody asked for.
- **Reading**: search before reading; read excerpts. **Never reread** a file
  you already read unless you edited it or there's concrete sign of external
  change. Query ai-memory before a large reread or asking the user to repeat
  context — only when the alternative is expensive. Surgical edits.
- **Tool calls**: batch independent calls. Load deferred tool schemas once,
  all together. Use a subagent only for large parallelizable work; mechanical
  work goes to `muri-delegate.mjs` (below).
- **Model/effort**: never switch on your own. Mechanical task at high effort
  → say so in one sentence and suggest the cheaper option the host offers.
- **Session (the biggest lever)**: task done + unrelated next request →
  suggest a fresh session (the automatic handoff keeps continuity). At a
  natural cut-off point, close even if "it could continue". Large context:
  a pointed question → memory query; otherwise close with a handoff.
- **Never** skip a needed test, drop a requirement or stop early to save tokens.

## Task profiles

- **Backend**: grep by signature/route; run only the relevant test; big log →
  grep the useful lines.
- **Frontend**: screenshot only at the end of a block; a theme/CSS file
  already read is in context.
- **Browser/QA**: screenshots only for visual questions, never for "did it
  load/click?"; batch browser actions; long visual QA → fresh session
  (images never leave the context).
- **Docs**: edit the right section without rereading the whole doc; long
  mechanical drafts → `gemini` delegate.
- **Git**: `status`/`diff` once; short `log`.
- **Debug**: reproduce once and analyze before rerunning; surgical logging.
- **Scaffold**: plan the tree and generate at once. **Refactor**: grep all
  usages once, edit in batch.

## Multi-agent orchestration (you orchestrate → Codex / Gemini)

You plan, decide, review and talk to the user. Mechanical or heavy work goes
to another quota:

`node ~/.claude/scripts/muri-delegate.mjs <gemini|codex> [--write] [--cd DIR] [--effort low|medium|high] [--file F] "<brief>"`

It returns ≤60 lines (full answer in a file), ~25-45 s per call.

| Task | Who | Mode |
|---|---|---|
| Wide sweep, "how does X work", log summary (`--file`), research, doc draft | `gemini` (`--effort low` for summaries) | automatic |
| Code review / second opinion | `codex` (read-only, real sandbox) | automatic |
| Well-specified implementation, boilerplate, mass refactor, tests | `codex --write` | announce "→ Codex will do X" and **wait for the OK** |
| Architecture, ambiguous decisions, final diff review, browser UI, conversation | you | — |

Details, exit codes and what never to delegate:
[references/delegation.md](references/delegation.md).

## Skills under trigger

Invoke only when the trigger really matches (they're installed separately;
see the repo's docs/skills-companion.md).

| Situation | Skill |
|---|---|
| A capability that probably exists as a skill | `find-skills` |
| Feature/bugfix before implementing | `tdd` |
| Validate a state model or layout before building | `prototype` |
| Formalize requirements for a big change | `openspec` |
| Architecture / "how does this code connect" | `graphify` |
| "muri saver" **alone**, no task | `grill-me` aimed at this skill + global instructions |
| Natural pause in a long project | **offer** `grill-me` (or `grill-with-docs` for an ADR) — never interrupt work |

## References (load only when needed)

- [Memory](references/memory.md): scope resolution, a retrieval miss, durable
  writes or session handoff.
- [Agents](references/agents.md): host-specific tools, hooks, models, the
  vault narrative and the background jobs.
- [Delegation](references/delegation.md): `muri-delegate.mjs` in depth.
- [Audit](references/audit.md): measured consumption, savings comparison and
  the weekly economy report.

If a reference is missing, use the available tool documentation; don't
invent capabilities or block ordinary work. Obsidian is optional; respect a
configured vault and never assume its location.

## Periodic review

Suggest a usage review every few weeks or when consumption changes for no
obvious reason (`~/.claude/scripts/muri-economy-report.py`, the host's usage view). A new actionable
finding becomes a one-line rule in the right place: always-on → global
instructions; used on most activations → this file; rare detail → a reference.
