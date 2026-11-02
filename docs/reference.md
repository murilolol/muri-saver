# Referência

Opções do instalador, comandos, configuração e detalhes por sistema. Para instalar, comece pelo [README](../README.md#instalar) ou pelo [`INSTALL.md`](../INSTALL.md). English: [`reference.en.md`](./reference.en.md).

## Opções do instalador

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `--with-all` | só o que for detectado | Configura Codex e Antigravity mesmo sem `~/.codex`/`~/.gemini` |
| `--vault <caminho>` | desligado | Vault do Obsidian usado pelos hooks e pelo ingestor |
| `--timezone <IANA>` | fuso do sistema | Nomes de arquivo e Dailies (ex.: `America/Sao_Paulo`) |
| `--language <tag>` | `pt-BR` | Idioma das narrativas |
| `--alias <nome>` | `muri-saver` | Instala com o seu nome (`--alias mendes-saver`); o original continua funcionando |
| `--narrative-chain <lista>` | `agy` Argon → `agy` Flash → Gemini API | Modelos da narrativa do vault; `off` deixa só o dump local |
| `--ai-memory-chain <lista>` | Gemini API → `agy` | Modelos que o shim oferece ao ai-memory |
| `--llm-key-file <caminho>` | — | Arquivo `KEY=valor` de onde ler a `GEMINI_API_KEY` (a chave nunca é copiada) |
| `--with-jobs` / `--jobs <lista>` / `--no-jobs` | nenhum | Jobs de fundo no agendador do SO |
| `--with-companion-skills` | não | Instala `find-skills`, `tdd`, `prototype`, `grill-with-docs` |
| `--update` / `--uninstall` | | Reaproveita a config salva / remove só o que não foi editado |
| `--dry-run` | | Mostra tudo e não escreve nada |

Configurações existentes são **mescladas**, nunca substituídas, e arquivos que
o instalador sobrescreve ganham backup em `~/.claude/muri-saver-backups/`.

## Comandos

`npx muri-saver <comando>` (ou `node bin/cli.mjs <comando>` num clone):

| Comando | Faz |
| --- | --- |
| `install` / `update` / `uninstall` | instala, atualiza, remove |
| `doctor` | verifica o ambiente inteiro, só leitura |
| `llm chain\|gemini\|anthropic\|off\|status\|tune` | provedor de LLM do ai-memory |
| `jobs list\|status\|install\|remove\|run` | jobs de fundo |
| `delegate <gemini\|codex> "<brief>"` | delega uma tarefa |
| `report [--days N] [--save]` | relatório de economia |
| `reprocess`, `backfill`, `finalize-idle` | rodam o job correspondente na hora |
| `ingest`, `audit` | importa histórico, audita consumo |

## Configuração

Tudo fica em `~/.claude/muri-saver.json`. O `--update` preserva o que você editar:

```json
{
  "alias": "muri-saver",
  "vault": "/caminho/do/vault",
  "timezone": "America/Sao_Paulo",
  "language": "pt-BR",
  "agents": ["claude", "codex", "antigravity"],
  "llm": {
    "narrative": ["agy:gemini-4-argon-high", "gemini-api:gemini-2.5-flash"],
    "apiKeyFile": "~/.config/muri-saver/llm.env",
    "shim": true
  },
  "narrative": { "intervalMinutes": 15 },
  "jobs": ["finalize-idle", "reprocess-parked", "quota-snapshot", "economy-report"]
}
```

`"vault": null` desliga o Obsidian. Precedência: flag > variável de ambiente
(`OBSIDIAN_VAULT`, `MURI_SAVER_TZ`, `MURI_SAVER_NARRATIVE_CHAIN`...) > arquivo.

No `~/.claude/settings.json`, o instalador mescla hooks e status line e mais
nada. O bloco `_recomendado` de [`claude-config/settings.snippet.json`](../claude-config/settings.snippet.json)
é o setup do autor pra copiar à mão: `autoCompactWindow` 250k,
`askUserQuestionTimeout` 10m, attribution vazio e `permissions.ask` pra
`git reset --hard`, `git push --force`, `git clean -f` e `rm -rf`.

## Cadeia de LLMs

Narrativa do vault e consolidação do ai-memory usam uma lista ordenada de
modelos. O primeiro que responder vence; erro de cota ou 5xx põe o modelo em
cooldown pelo tempo que o erro indicar, e o próximo assume.

| Tipo | Cota | Precisa de |
| --- | --- | --- |
| `gemini-api:<modelo>` | grátis, separada por modelo | `GEMINI_API_KEY` |
| `agy:<modelo>` | plano Google (Antigravity) | `agy` instalado |
| `claude:<modelo>` | **a do seu plano Claude** | `claude` instalado |
| `openai:<modelo>` | do provedor (Ollama, OpenRouter, Groq...) | `llm.openai.baseUrl` |

Nenhum padrão usa a cota do Claude. Guia completo: [`docs/llm-chain.md`](./llm-chain.md).

## Jobs de fundo

| Job | Quando | Para sozinho |
| --- | --- | --- |
| `llm-shim` | serviço | — |
| `finalize-idle` | de hora em hora | — |
| `reprocess-parked` | toda hora, minuto 10 | quando a fila zera |
| `vault-backfill` | a cada 2h | quando a fila zera |
| `quota-snapshot` | de hora em hora | — |
| `economy-report` | segunda 09:00 | — |

Registrados no **launchd** (macOS), **systemd --user** ou **crontab** (Linux) e
**Agendador de Tarefas** (Windows). Sem modelo livre, os jobs de fila saem na
hora sem gastar nada. Guia: [`docs/background-jobs.md`](./background-jobs.md).

Processo preso (`agy` headless, worker da nota viva)? `scripts/faxineiro.sh`
(macOS/Linux) mata o que passou do tempo; `--dry-run` só lista.

## Multiplataforma

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Hooks, instalador, ingestor, doctor | ✓ | ✓ | ✓ |
| Jobs de fundo | launchd | systemd --user / crontab | Agendador de Tarefas |
| CLIs do npm (`claude`, `agy`, `codex`) | PATH | PATH | o shim `.cmd` é lido e o `.js`/`.exe` real é chamado sem shell |
| Banco do ai-memory | `node:sqlite` (Node ≥ 22.5) ou `sqlite3` | idem | idem |
| Dados do ai-memory | lidos de `ai-memory status --json` | idem | idem |

Nada no código usa caminho fixo de usuário. O registro real de jobs foi exercitado no macOS;
no Linux e no Windows, a geração dos arquivos (`.timer`, XML da tarefa) é coberta
por teste.

## Desenvolvimento local

```bash
npm test                                      # 93 testes, node:test
node bin/install.mjs --dry-run --with-all     # nada é escrito
HOME="$(mktemp -d)" MURI_SAVER_SCHEDULER=dry node scripts/muri-jobs.mjs install --all   # grava os arquivos dos jobs numa home temporária, sem registrar
node scripts/muri-jobs.mjs list
node scripts/vault-backfill.mjs --dry-run
node scripts/ai-memory-reprocess-parked.mjs --scan --dry-run
```

Os testes rodam numa home temporária, com o agendador em `dry`, a cadeia de LLMs
desligada e binários falsos de `agy`/`ai-memory` em `tools/test-bin/`. Nenhum
teste toca a sua configuração real nem chama um modelo.
