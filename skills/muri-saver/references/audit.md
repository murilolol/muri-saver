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

For an A/B comparison, hold task, checkout, model/settings, tools and quality
criteria constant; use fresh equivalent sessions and several repetitions.
Compare correctness alongside tokens/time and disclose cache differences.
Report measured results with their conditions; never guarantee a percentage.
