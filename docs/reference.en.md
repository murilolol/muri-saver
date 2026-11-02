# Reference

Installer options, commands, configuration and per-OS details. To install, start from the [README](../README.en.md#install) or [`INSTALL.md`](../INSTALL.md). Português: [`reference.md`](./reference.md).

## Installer options

| Option | Default | Description |
| --- | --- | --- |
| `--with-all` | only what's detected | Set up Codex and Antigravity even without `~/.codex`/`~/.gemini` |
| `--vault <path>` | off | Obsidian vault used by hooks and the ingestor |
| `--timezone <IANA>` | system zone | File names and daily notes |
| `--language <tag>` | `pt-BR` | Narrative language (e.g. `en`) |
| `--alias <name>` | `muri-saver` | Install under your own name; the original still works |
| `--narrative-chain <list>` | `agy` Argon → `agy` Flash → Gemini API | Vault narrative models; `off` keeps only the local dump |
| `--ai-memory-chain <list>` | Gemini API → `agy` | Models the shim offers to ai-memory |
| `--llm-key-file <path>` | — | `KEY=value` file to read `GEMINI_API_KEY` from (the key is never copied) |
| `--with-jobs` / `--jobs <list>` / `--no-jobs` | none | Background jobs in the OS scheduler |
| `--with-companion-skills` | no | Installs `find-skills`, `tdd`, `prototype`, `grill-with-docs` |
| `--update` / `--uninstall` | | Reuse the saved config / remove only what you didn't edit |
| `--dry-run` | | Show everything, write nothing |

Existing configs are **merged**, never replaced, and overwritten files are
backed up to `~/.claude/muri-saver-backups/`.

## Commands

`npx muri-saver <command>` (or `node bin/cli.mjs <command>` in a clone):
`install`, `update`, `uninstall`, `doctor`, `llm chain|gemini|anthropic|off|status|tune`,
`jobs list|status|install|remove|run`, `delegate <gemini|codex> "<brief>"`,
`report [--days N] [--save]`, `reprocess`, `backfill`, `finalize-idle`, `ingest`, `audit`.

## Configuration

Everything lives in `~/.claude/muri-saver.json`; `--update` keeps what you edit:

```json
{
  "vault": "/path/to/vault",
  "timezone": "Europe/Lisbon",
  "language": "en",
  "llm": { "narrative": ["agy:gemini-4-argon-high", "gemini-api:gemini-2.5-flash"], "shim": true },
  "narrative": { "intervalMinutes": 15 },
  "jobs": ["finalize-idle", "reprocess-parked"]
}
```

`"vault": null` turns Obsidian off. Precedence: flag > environment
(`OBSIDIAN_VAULT`, `MURI_SAVER_TZ`, `MURI_SAVER_NARRATIVE_CHAIN`...) > file.

In `~/.claude/settings.json` the installer merges hooks and the status line,
nothing else. The `_recomendado` block in [`claude-config/settings.snippet.json`](../claude-config/settings.snippet.json)
is the author's setup to copy by hand: `autoCompactWindow` 250k,
`askUserQuestionTimeout` 10m, empty attribution and `permissions.ask` for
`git reset --hard`, `git push --force`, `git clean -f` and `rm -rf`.

## LLM chain

The vault narrative and ai-memory consolidation use an ordered list of models.
The first one that answers wins; a quota error or 5xx cools that model down
for as long as the error says, and the next one takes over.

| Kind | Quota | Needs |
| --- | --- | --- |
| `gemini-api:<model>` | free, per model | `GEMINI_API_KEY` |
| `agy:<model>` | Google plan (Antigravity) | `agy` installed |
| `claude:<model>` | **your Claude plan** | `claude` installed |
| `openai:<model>` | the provider's (Ollama, OpenRouter, Groq...) | `llm.openai.baseUrl` |

No default touches the Claude quota. Schedulers don't read your shell profile,
so `llm.apiKeyFile` can point at a `KEY=value` file (even `~/.zprofile`); the
key is never written by muri-saver.

## Background jobs

| Job | When | Stops by itself |
| --- | --- | --- |
| `llm-shim` | service | — |
| `finalize-idle` | hourly | — |
| `reprocess-parked` | hourly at :10 | when its queue is empty |
| `vault-backfill` | every 2h | when its queue is empty |
| `quota-snapshot` | hourly | — |
| `economy-report` | Monday 09:00 | — |

Registered with **launchd** (macOS), **systemd --user** or **crontab** (Linux)
and **Task Scheduler** (Windows). With no free model, queue jobs exit
immediately without spending anything.

A process got stuck (headless `agy`, live-note worker)? `scripts/faxineiro.sh`
(macOS/Linux) kills whatever ran past its time; `--dry-run` only lists.

## Cross-platform

No hardcoded user paths anywhere. npm-installed CLIs on Windows are `.cmd`
shims: muri-saver reads the shim and runs the real `.js`/`.exe` directly,
without a shell. The ai-memory data dir comes from `ai-memory status --json`;
its database is read with `node:sqlite` (Node ≥ 22.5) or the `sqlite3` CLI.
Real job
registration has been exercised on macOS; on Linux and Windows the generated
files (`.timer`, task XML) are covered by tests.

## Local development

```bash
npm test                                      # 93 tests, node:test
node bin/install.mjs --dry-run --with-all
HOME="$(mktemp -d)" MURI_SAVER_SCHEDULER=dry node scripts/muri-jobs.mjs install --all   # writes the job files into a temp home
node scripts/vault-backfill.mjs --dry-run
```

Tests run in a temporary home, with the scheduler in `dry` mode, the LLM chain
off and fake `agy`/`ai-memory` binaries from `tools/test-bin/`.
