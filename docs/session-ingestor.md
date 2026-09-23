# Ingestor de Sessões (`bin/ingest-sessions.mjs`)

Varre as sessões que cada IA já gravou sozinha na sua máquina — antes mesmo de
você instalar o muri-saver — e registra elas retroativamente no Obsidian Vault
e/ou no `ai-memory`. Útil pra quem já usa Claude Code/Antigravity/Codex há
meses e não quer perder esse histórico só porque os hooks deste repositório
não estavam instalados ainda.

## Por que não chama nenhuma LLM

Os hooks deste repositório (`hooks/obsidian-vault-check.mjs`) chamam
`claude -p` pra gerar uma narrativa rica de sessões **substanciais**, uma por
uma, em tempo real. Fazer isso retroativamente pra uma varredura de
possivelmente milhares de sessões custaria uma fortuna e contradiria a
filosofia de economia do próprio projeto — por isso o ingestor **nunca chama
LLM nenhuma**. Toda sessão importada vira o equivalente ao "dump bruto" que os
hooks já usam pra sessões triviais: prompts e respostas extraídos localmente,
sem narrativa gerada, sem categorização automática em `projects/<projeto>/<categoria>/`
(essa parte exige um julgamento de LLM que este script de propósito não faz).

## Fontes suportadas e onde cada uma guarda sessão

| Agente | Onde | Formato |
|---|---|---|
| Claude Code | `~/.claude/projects/<cwd-slugificado>/<session-id>.jsonl` | JSON Lines — um evento por linha (`type: "user"\|"assistant"`, `message.content`) |
| Antigravity / Gemini CLI | `~/.gemini/antigravity-cli/brain/<conversation-id>/.system_generated/logs/transcript_full.jsonl` (fallback `transcript.jsonl`) | JSON Lines — `type: "USER_INPUT"\|"PLANNER_RESPONSE"\|...`, `content` string, `tool_calls[]` |
| Codex CLI | `~/.codex/sessions/<ano>/<mes>/<dia>/rollout-<timestamp>-<session-id>.jsonl` | JSON Lines — `type: "response_item"` com `payload.type: "message"\|"function_call"\|...` |
| Codex CLI (SQLite) | `~/.codex/*.sqlite` (`thread_history_1.sqlite` etc.) | **Detectado, não parseado** — este script é zero-dependência de propósito e não traz um driver de SQLite. O `.jsonl` de `~/.codex/sessions/` já cobre o mesmo histórico na prática; o `--dry-run` avisa quando encontra arquivos `.sqlite` extras. |
| Claude Desktop/Web | arquivo `conversations.json` exportado manualmente (Configurações → Exportar dados) | JSON — array de conversas, cada uma com `chat_messages`/`messages` |

Cada fonte tem seu próprio parser em `bin/ingest-sessions.mjs`
(`parseClaudeSession`, `parseAntigravitySession`, `parseCodexSession`,
`parseDesktopFile`) — todos tolerantes a linhas malformadas (ignoram e
seguem) e a formatos que mudem em versões futuras dos agentes (o script nunca
lança uma exceção só porque uma sessão específica é ilegível).

## Detecção de projeto

- **Claude Code**: lê o campo `cwd` presente nos próprios eventos da
  transcrição (mais confiável que tentar reverter a slugificação do nome da
  pasta, que é ambíguo quando o projeto original já tem `-` no nome).
- **Codex**: lê `payload.cwd` do evento `session_meta` (primeira linha do
  rollout).
- **Antigravity**: não expõe um campo `cwd` estruturado nas transcrições —
  o script tenta inferir a partir do primeiro `tool_calls[].args.path`/`TargetFile`
  encontrado; se não achar nada, a sessão é gravada sem projeto associado
  (`project: null`).
- **Claude Desktop/Web**: não tem conceito de `cwd`; nunca associa projeto.

O nome do projeto usado nas notas é só o `basename` do caminho detectado (ex:
`/Users/voce/Documents/site` → `site`) — não a taxonomia completa de 12
categorias que os hooks ao vivo mantêm (ver acima, por que não chama LLM).

## Sanitização

Antes de gravar qualquer coisa (vault, `ai-memory` ou `--export-dir`), cada
mensagem passa por três passadas, nessa ordem:

1. **Mascaramento de segredos** (`maskSecrets`): regexes pra chaves da
   Anthropic (`sk-ant-...`), OpenAI-like (`sk-...`), GitHub (`ghp_...` e
   variantes), Slack (`xox...`), AWS (`AKIA...` e `aws_secret_access_key=...`),
   JWT, `Bearer <token>`, e atribuições de senha (`senha=`/`password=`).
   Cada ocorrência vira `***REDACTED-<TIPO>***`.
2. **Expurgo de tags de sistema** (`stripSystemTags`): remove marcadores
   internos que vazam nas transcrições brutas (`<USER_REQUEST>`,
   `<SYSTEM_MESSAGE>`, `<PLAN>`, `<ADDITIONAL_METADATA>`, `<CONTEXT_SUMMARY>`,
   `<local-command-caveat>`, etc.) — mantém o texto interno, remove só o
   marcador.
3. **Blindagem anti-quebra do Obsidian** (`escapeStrayHtml`): qualquer outra
   tag HTML/JSX/SVG solta que sobrar vira inline-code (`` `<div>` ``) — a
   mesma técnica já usada em produção por `hooks/obsidian-vault-check.mjs`,
   pra nunca deixar uma tag desbalanceada engolir o resto da nota.

O `title:` do frontmatter YAML é sempre gerado com aspas e escaping próprio
(`yamlQuote`) — títulos vêm do primeiro prompt real do usuário, texto
arbitrário que pode conter `:` (que quebraria YAML sem aspas) ou `"`.

## Idempotência

Cache em `~/.claude/cache/.muri-saver-ingested.json`, chaveado por
`<agente>:<id-da-sessão>`, guardando um fingerprint barato (`tamanho:mtime`
do arquivo fonte) — não o conteúdo. Uma sessão só é reprocessada se:
- o fingerprint mudou (ex: uma sessão do Claude Code ainda ativa, sendo
  escrita pelo processo real, tem timestamp/tamanho diferentes a cada rodada
  do ingestor); ou
- `--force` foi passado.

`--dry-run` nunca toca o cache (nem lê pra decidir pular, além de informar o
status — nem grava).

## Destinos

- **Obsidian Vault** (padrão, desativável com `--skip-vault`): mesma
  convenção de pasta dos hooks — `dailies/` raiz cross-agente pra
  claude/antigravity/desktop, `codex/dailies/` própria pro Codex (não compete
  com a raiz). Sessão em `<agente>/sessions/Session-YYYY-MM-DD_HHhMM-<Tag>-<id8>.md`.
  Idempotente também no nível do arquivo (não sobrescreve se já existe uma
  sessão com o mesmo id no vault, mesmo se o cache tiver sido apagado).
- **`ai-memory`** (padrão, desativável com `--skip-ai-memory`): via CLI
  (`ai-memory write-page --path sessions/imported-<agente>-<data>-<id8>.md --body -
  --tier episodic -t session -t <agente> -t muri-saver -t imported [-t <projeto>]
  [--project <projeto>]`). Se o binário não estiver disponível no PATH nem em
  `~/.local/bin`/`~/.cargo/bin`, o script avisa e segue sem falhar a sessão
  inteira.
- **`--export-dir <caminho>`**: ignora vault e `ai-memory` por completo — só
  escreve um `.md` avulso por sessão em `<caminho>/<agente>-<data>_<hora>-<id8>.md`.
  Útil pra quem não tem nem Obsidian nem `ai-memory` configurados ainda, ou
  quer revisar antes de importar de verdade.

## Flags

Ver `node bin/ingest-sessions.mjs --help` pra lista completa. Combine como
quiser, ex:

```bash
# Simulação total, todos os agentes
node bin/ingest-sessions.mjs --all --dry-run

# Só as 20 sessões mais recentes do Claude Code
node bin/ingest-sessions.mjs --agent claude --limit 20

# Só Antigravity, a partir de uma data
node bin/ingest-sessions.mjs --agent antigravity --since 2026-09-01

# Exportar Claude Desktop/Web pra Markdown avulso, sem tocar vault/ai-memory
node bin/ingest-sessions.mjs --file ./conversations.json --export-dir ./out
```
