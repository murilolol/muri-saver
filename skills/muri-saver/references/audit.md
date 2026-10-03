# Observe before claiming savings

In a repository checkout, run `node bin/cli.mjs audit --instructions-only`
for instruction sizes or `node bin/cli.mjs audit --agent claude --limit 3`
for recent transcripts. `--file <path> --json` inspects one JSONL source.
The standalone marketplace package also provides `node scripts/audit.mjs`.
If these scripts are absent, ask for observed usage rather than inventing it.

The audit runs locally without LLM/network calls or writes. It exports sizes,
reported usage and tool-call signatures, not prompts or arguments. Paths and
tool names can still be private; inspect reports before sharing.

- Claude: input includes uncached input, cache reads and cache creation;
  streaming usage for one message ID is counted once. Missing cache counters
  mark input/total as partial rather than claiming zero cache use.
- Codex: use the final cumulative usage snapshot; cached input is already part
  of input, and reasoning is already part of output. Do not sum snapshots.
- Antigravity: tool-call repetition is supported; unavailable token counters
  remain unknown. SQLite-only Codex threads are skipped by this audit.
- Repetition is a signal to inspect, not proof of waste. An edit opens a new
  interval; changed state, retries and verification can justify another call.
- Bytes/words are not tokens. Observed tokens are not subscription quota or
  dollars, and a long elapsed session is not necessarily active work.

## Weekly economy report

`node ~/.claude/scripts/muri-economy-report.py [--days N] [--cutoff ISO] [--save]`
reads the Claude Code transcripts and estimates
**tokens-eq** (a proxy for plan weight: input 1, cache write 1.25/2, cache
read 0.1, output 5; Sonnet 0.6, Haiku 0.2). It calibrates "1% of the weekly
quota ≈ X tokens-eq" from your own data, compares the first-turn fixed cost
before/after a cutoff, and lists the work that ran outside the Claude quota
(delegations, ai-memory shim calls, vault narratives, backfill). The
`quota-snapshot` and `economy-report` jobs keep a history and save a weekly
note in the vault. The formula is an estimate; the provider doesn't publish
the quota math.

For an A/B comparison, hold task, checkout, model/settings, tools and quality
criteria constant; use fresh equivalent sessions and several repetitions.
Compare correctness alongside tokens/time and disclose cache differences.
Report measured results with their conditions; never guarantee a percentage.
