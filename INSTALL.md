# Instalação

> Tem uma IA à mão (Claude Code, Codex, Antigravity...)? É bem mais rápido
> mandar o link deste repositório pra ela e pedir pra instalar — o runbook
> completo, autônomo e que detecta o sistema operacional sozinho está em
> **[`INSTALL-AI.md`](./INSTALL-AI.md)**. Este documento aqui é a versão pra
> fazer manualmente, ou pra revisar o que a IA vai fazer antes de deixar ela
> rodar.

## Pré-requisitos

| Ferramenta | Por quê | Link |
|---|---|---|
| Node.js ≥ 18 | Roda os hooks (`.mjs`) e o instalador (`bin/`) | [nodejs.org](https://nodejs.org) |
| Python 3 | Roda `scripts/usage-status.py` e `scripts/statusline.py` | já vem no macOS/Linux; [python.org](https://python.org) no Windows |
| [Claude Code](https://claude.com/claude-code) | O client que carrega a skill, os hooks e o `CLAUDE.md` | — |
| [ai-memory](https://github.com/akitaonrails/ai-memory) | Memória persistente cross-sessão (ver [explicação completa no README](./README.md#ai-memory)) | binário próprio, instalado à parte |
| [Obsidian](https://obsidian.md) | Onde o vault de registro humano-legível vive | opcional, mas recomendado |

## Passo 1 — Instalar a skill, os hooks e o `CLAUDE.md`

```bash
git clone https://github.com/murilolol/muri-saver.git
cd muri-saver
node bin/install.mjs --dry-run   # revise o que seria feito, nada é escrito ainda
node bin/install.mjs             # instala de verdade (nunca sobrescreve sem fazer backup antes)
```

Isso copia a skill `muri-saver` (e `grill-me`) pra `~/.agents/skills/`, os
hooks pra `~/.claude/hooks/`, os scripts pra `~/.claude/scripts/`, mescla os
hooks `Stop`/`SessionStart` no seu `~/.claude/settings.json`, e cria
`~/.claude/CLAUDE.md` a partir do template (só se você ainda não tiver um).

### Personalize com o seu nome (`--alias`)

Quer usar `mendes-saver`, `lucas-saver` ou só `lucas` em vez de `muri-saver`?
Passe `--alias`:

```bash
node bin/install.mjs --alias mendes-saver --author-name Mendes
```

Isso renomeia a skill, o `CLAUDE.md`/`GEMINI.md`/`AGENTS.md` e todos os
gatilhos de ativação — `"mendes saver"`, `"mendes-saver"`, `"/mendes-saver"` —
mantendo `"muri-saver"`/`"muri saver"` funcionando como alias alternativo
herdado do padrão original. Sem `--alias`, o padrão continua sendo
estritamente `muri-saver`.

### Multi-agente (`--with-codex`, `--with-antigravity`, `--with-all`)

Além do Claude Code (sempre instalado), o instalador também configura
Antigravity/Gemini CLI e Codex CLI:

```bash
node bin/install.mjs --with-antigravity   # GEMINI.md + skill em ~/.gemini/
node bin/install.mjs --with-codex         # AGENTS.md + hook em ~/.codex/
node bin/install.mjs --with-all           # os três de uma vez
```

Sem essas flags, o instalador ainda detecta sozinho se `~/.gemini` ou
`~/.codex` já existem (sinal de que você já usa aquele agente) e configura
automaticamente mesmo assim — as flags só forçam a instalação quando a pasta
ainda não existe.

Outras flags úteis: `--vault "<caminho>"` (cria a estrutura de pastas do
Obsidian), `--with-companion-skills` (instala
`find-skills`/`tdd`/`prototype`/`grill-with-docs` automaticamente). Detalhes
de todas em [`INSTALL-AI.md`](./INSTALL-AI.md#passo-1--clonar-e-rodar-o-instalador).

## Passo 2 — Instalar e configurar o `ai-memory`

O `ai-memory` é a peça que dá memória persistente cross-sessão a este setup
— ver a explicação completa de [o que é e por que ele importa no
README](./README.md#ai-memory). Siga
[`docs/ai-memory-obsidian-setup.md`](./docs/ai-memory-obsidian-setup.md) pra
instalar o binário, registrar os hooks oficiais dele
(`ai-memory install-hooks`), e ativar o modo session-aware do MCP.

## Passo 3 — Conectar o MCP (ai-memory + Obsidian)

Abra [`mcp/mcp-servers.example.json`](./mcp/mcp-servers.example.json), troque
`<CAMINHO_DO_SEU_VAULT>` pelo caminho real do seu vault, e mescle as duas
entradas dentro da chave `mcpServers` do seu `~/.claude.json` — sem
sobrescrever o arquivo inteiro (ele guarda outras coisas suas).

## Passo 4 — Verificar tudo

```bash
node bin/doctor.mjs --vault "<caminho-do-seu-vault>"
```

Confere Node, Python, Claude Code CLI, binário e servidor do `ai-memory`,
hooks registrados, plugin `claude-obsidian`, MCP servers, app Obsidian
instalado, a estrutura de pastas do vault, o alias configurado (padrão ou
customizado) e as sessões brutas/governança de cada agente (Claude
Code/Antigravity/Codex) — tudo numa passada, com `OK`/`AVISO`/`FALHA` por
item.

## Passo 5 — Importar sessões antigas (opcional)

Já usava Claude Code, Antigravity ou Codex antes de instalar o muri-saver?
O ingestor varre o histórico local de cada um e registra retroativamente no
Obsidian Vault e/ou no `ai-memory` — sem chamar nenhuma LLM (extração 100%
local):

```bash
node bin/ingest-sessions.mjs --all --dry-run   # simulação, veja o que seria importado
node bin/ingest-sessions.mjs --all --limit 20  # importa as 20 sessões mais recentes de cada agente
```

Detalhes completos (formato de cada fonte, sanitização, idempotência) em
[`docs/session-ingestor.md`](./docs/session-ingestor.md).

## Skills companheiras (opcional)

`find-skills`, `tdd`, `prototype`, `grill-with-docs`, `openspec`,
`graphify` e `impeccable` não são instaladas por `bin/install.mjs` a menos
que você use `--with-companion-skills` (e mesmo assim, só as 4 primeiras têm
instalação automática confiável). Cada uma tem uma página própria em
[`skills/companion/`](./skills/companion/) explicando o que é, quem fez, e o
comando exato de instalação — índice completo em
[`docs/skills-companion.md`](./docs/skills-companion.md), que também lista
`emil-design-eng` e `taste-skill` (ainda não uso, mas pretendo).

Atenção: `grill-me` **não** está nessa lista porque já foi instalada no
Passo 1 (é vendorizada, sempre acontece). `grill-with-docs` é diferente —
uso as duas juntas, não uma no lugar da outra; ver a comparação em
[`docs/skills-companion.md`](./docs/skills-companion.md#grill-me-vs-grill-with-docs--uso-as-duas-pra-situações-diferentes).

## Documentação de apoio

| Documento | Conteúdo |
|---|---|
| [`docs/architecture.md`](./docs/architecture.md) | Visão geral / por que cada peça existe |
| [`docs/ai-memory-obsidian-setup.md`](./docs/ai-memory-obsidian-setup.md) | `ai-memory` + Obsidian (binário, MCP, marker file) |
| [`docs/skills-companion.md`](./docs/skills-companion.md) | Skills de terceiros que uso e recomendo |
| [`docs/session-ingestor.md`](./docs/session-ingestor.md) | Como `bin/ingest-sessions.mjs` importa sessões antigas de cada agente |
| [`INSTALL-AI.md`](./INSTALL-AI.md) | Runbook completo pra uma IA instalar sozinha |
