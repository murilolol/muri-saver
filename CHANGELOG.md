# Changelog

Todas as mudanças relevantes do muri-saver. Formato inspirado em
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [3.1.0] — 2026-10-03

Versão que junta o que estava rodando só na máquina do autor (orquestração
multi-agente 3.0 e os consertos de 3.1) e deixa tudo instalável em macOS, Linux
e Windows.

### Adicionado

- **Nota viva v2 no Obsidian** ([docs/vault-live-notes.md](./docs/vault-live-notes.md)):
  dump local garantido em todo `Stop`, narrativa por LLM num worker destacado
  regerada a cada 15 min de sessão e de novo no `SessionEnd`, só os blocos
  `<!-- auto-narrativa -->`/`<!-- auto-dump -->` são substituídos, linha
  `↳ Narrativa` no Daily, `.canvas` por sessão.
- **Cadeia de LLMs com fallback** ([docs/llm-chain.md](./docs/llm-chain.md)):
  `hooks/muri-llm.mjs` com os tipos `gemini-api`, `agy`, `claude` e `openai`
  (qualquer endpoint compatível), cooldown compartilhado por modelo, cota diária
  do Gemini calculada no fuso do Pacífico, entrada indisponível pulada sem custo.
- **Shim do ai-memory** (`scripts/ai-memory-llm-shim.mjs`): provedor
  OpenAI-compatível local que dá ao ai-memory a mesma cadeia. `muri-saver llm`
  troca o provedor (`chain`/`gemini`/`anthropic`/`off`), mostra o status e aplica
  os limites recomendados (`tune`).
- **Jobs de fundo multiplataforma** ([docs/background-jobs.md](./docs/background-jobs.md)):
  `scripts/muri-jobs.mjs` registra no launchd (macOS), `systemd --user` ou
  `crontab` (Linux) e Agendador de Tarefas (Windows). Jobs: `llm-shim`,
  `finalize-idle`, `reprocess-parked`, `vault-backfill`, `quota-snapshot`,
  `economy-report`. Os de fila se desativam sozinhos quando terminam.
- **Reprocessamento de sessões estacionadas** do ai-memory, com fila montada a
  partir dos logs, parada imediata sem modelo livre, uma segunda passada para
  falhas e trava de instância.
- **Finalização de sessões ociosas** no ai-memory (o Antigravity não tem
  `SessionEnd`), lendo o banco por `node:sqlite` ou `sqlite3`.
- **Backfill do vault** para notas que ficaram só com o dump.
- **Ponte vault → ai-memory** para o Antigravity, cujo conteúdo o ai-memory não
  captura.
- **`muri-delegate.mjs`** ([docs/delegation.md](./docs/delegation.md)): delega
  leitura/pesquisa ao Gemini (`agy`) e revisão/implementação ao Codex, na cota
  deles, com proteção de somente leitura, anti-recursão e log.
- **Relatório de economia** ([docs/economy-report.md](./docs/economy-report.md)):
  tokens-eq por modelo e dia, calibração "1% da cota ≈ X", custo fixo antes ×
  depois, trabalho fora da cota do Claude.
- **`aim-guard`**: as chamadas headless do próprio muri-saver ao `agy` não viram
  sessões-lixo no ai-memory (o instalador embrulha os hooks do ai-memory no
  Antigravity e o `--uninstall` desfaz).
- Instalador: `--with-jobs`, `--jobs`, `--no-jobs`, `--narrative-chain`,
  `--ai-memory-chain`, `--llm-key-file`, `--language`; hook `SessionEnd` no Claude
  Code e no Codex.
- CLI: `muri-saver jobs | llm | delegate | report | reprocess | backfill | finalize-idle`.
- Doctor: seção de cadeia de LLMs, shim, provedor do ai-memory e jobs.
- 35 testes novos (92 no total), com `agy`/`ai-memory` falsos em `tools/test-bin/`.
- `CONTRIBUTING.md`.

### Mudado

- Governança (`CLAUDE.md`/`AGENTS.md`/`GEMINI.md`) e skill `muri-saver` no
  formato núcleo 3.1: regras universais, perfil por tarefa e orquestração
  multi-agente; histórico e números ficam nos docs.
- O hook do Codex virou um repassador do pipeline único (antes gravava notas
  próprias, sem conteúdo).
- `--update` preserva qualquer chave que você editou no `muri-saver.json`.
- Logs e estado ficam ao lado da instalação; rodando de um clone, em `~/.claude`
  (o repositório nunca é sujo).
- Segredos são mascarados também no texto enviado ao modelo, não só no vault.

### Corrigido

- Toda sessão marcada como "modo muri-saver" porque a detecção lia a lista de
  skills e o `CLAUDE.md` injetados no transcript; agora só o que o usuário digitou.
- Primeiro `Stop` (uma mensagem só) classificava a sessão como trivial e ela
  nunca ganhava narrativa.
- A nota congelava no primeiro turno (`sessionDone`).
- Logs não eram gravados numa home nova (pasta inexistente).
- `claude.cmd` e outros CLIs do npm no Windows: o shim `.cmd` é lido e o
  `.js`/`.exe` real é chamado direto, sem shell.

### Removido

- `scripts/ai-memory-llm-mode.sh` e `.ps1` (substituídos por um `.mjs` único).
- `scripts/test-vault-hooks.sh` (substituído pela suíte `node --test`).

### Migrando de uma instalação manual

Quem tinha os scripts soltos (LaunchAgents `com.muri.*`): rode
`node bin/install.mjs --update --with-jobs`, confira com `muri-saver jobs status`
e descarregue os antigos com `launchctl bootout gui/$(id -u)/com.muri.<nome>`. A
fila de sessões estacionadas no formato antigo (2 colunas) continua válida.

## [2.1.0]

- Skills em inglês com núcleo curto e referências sob demanda.
- Templates globais de ~59 KB para ~8 KB.
- Comando `audit` somente leitura (tokens observados, tamanho das instruções,
  chamadas repetidas).
- ZIPs reproduzíveis das skills para marketplaces.

## [2.0.0]

- Vault, fuso e alias configuráveis em `~/.claude/muri-saver.json`.
- Máscara de segredos no hook e no ingestor.
- `--update`, `--uninstall`, manifesto com sha256.
- Ingestor lendo o SQLite do Codex, pulando subagentes, `--enrich` opcional.
- Suíte `node --test` e CI em macOS, Linux e Windows.
