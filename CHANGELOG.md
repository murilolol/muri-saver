# Changelog

Todas as mudanças relevantes do muri-saver. Formato inspirado em
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [Unreleased]

### Segurança
- Máscara de segredos com padrão genérico chave=valor (`api_key=`, `*_TOKEN=` com nome de qualquer
  tamanho, `client_secret:`, `"access_token": "..."`, JSON escapado e `Authorization: Basic`), nos
  hooks e no ingestor. Troca só o valor e mantém a chave. Ficam de fora número puro
  (`max_token=128000`, `max_tokens=128000`) e chamada de código (`token = getAuthToken()`).
- A cópia normalizada do transcript do Codex vai para uma pasta temporária 0700, com arquivo 0600,
  e é apagada quando o hook termina (antes ficava em `muri-codex-*.jsonl`, legível e sem limpeza).
- `muri-delegate`: o conteúdo de `--file` passa pela máscara de segredos antes de ir ao delegado;
  resposta e log ficam numa pasta temporária 0700 por execução, e cada delegação apaga as pastas
  `muri-delegate-*` com mais de 7 dias (no Windows ninguém limpa o `%TEMP%`).
- Shim LLM (`127.0.0.1:49380`): recusa `Host` fora do loopback (403) e POST sem
  `Content-Type: application/json` (415). A recusa vai para o log do shim; o ai-memory 3.2.0
  manda `127.0.0.1` e `application/json` (conferido com `ai-memory llm-test`).

### Instalador
- Parser estrito: flag que pede valor e vem sem ele, ou seguida de outra flag, para com exit 1
  antes de tocar em qualquer coisa. Antes, `--vault --dry-run` gravava o vault `--dry-run` e
  fazia uma instalação real.
- Flag desconhecida para com exit 1 e não instala nada; no `--dry-run` vira só aviso.
- Merge e remoção dos hooks comparam o caminho do script (`.py`/`.mjs` em `command` ou `args`),
  não o JSON inteiro. Reinstalar sobre uma forma antiga (outro `statusMessage`, `timeout`, ou
  `python3 x.py` num comando só) troca a entrada em vez de duplicar, o que fazia o Stop rodar o
  hook do vault duas vezes por turno. Hooks seus no mesmo grupo ficam. O `--uninstall` também
  remove as formas antigas.
- O log do merge lista o que muda em cada arquivo (`hooks.Stop`, `hooks.UserPromptSubmit`,
  `statusLine`...), no lugar do rótulo fixo "hooks Stop/SessionStart".
- Skills `muri-saver` (com o alias) e `grill-me` também em `~/.claude/skills`, a única pasta que
  o Claude Code carrega (`~/.agents/skills` ele só usa para importar). O `doctor` confere as
  duas pastas.
- O hook do guarda e a status line chamam o Python que existe no PATH (`python3`/`python`, ou
  `python`/`py`/`python3` no Windows), no lugar de `python3` fixo. A busca saiu do `cli.mjs` para
  `lib/exec.mjs`.

### Documentação
- `npx muri-saver` (o pacote não existe no npm) vira `node bin/cli.mjs` em READMEs, INSTALL,
  INSTALL-AI, docs e help do CLI; a rota sem clonar usa `npx github:murilolol/muri-saver`.
- Dica final do instalador (passo 6) e nota dos READMEs sobre `report`/`audit` também com
  `node bin/cli.mjs`, que funciona num clone sem nada no PATH.
- Instalador e `settings.snippet.json`: a dica do ai-memory leva `--apply` e soma
  `install-mcp --client claude-code --session-aware --apply`; com Codex ou Antigravity detectados,
  cita `--agent codex`/`antigravity-cli` e o `--update` que religa o aim-guard.
- `skills-companion.md`: link do OpenSpec (`Fission-AI/OpenSpec`), colisão do `prototype`
  (Matt Pocock × Emil Kowalski), status de `emil-design-eng` e `taste-skill`, nota do superpowers.
- "Testado com o ai-memory 3.2.x" no INSTALL e no guia do ai-memory.
- README pt/en: bloco "Instalar em 1 minuto" no topo, com requisitos e "0 dependências npm";
  `evaluation.md` e `marketplace.md` entram na tabela de documentação.
- CHANGELOG: `[Unreleased]`, datas da 2.0.0 e da 2.1.0 e links de comparação.

### CI
- O último run (2026-09-25) não chegou a rodar: os jobs foram recusados por bloqueio de
  cobrança da conta, não por teste. O workflow sobe para `actions/checkout@v7` e
  `actions/setup-node@v7` (runtime Node 24; as v4 rodavam no Node 20, descontinuado) e ganha
  `workflow_dispatch`. Matriz mantida: macOS, Linux e Windows × Node 18, 22 e 24.

## [3.2.0] — 2026-11-01

Sincroniza o repo com o setup do autor no macOS (out/2026).

### Adicionado
- **Guarda de contexto** (`hooks/guarda-contexto.py`, UserPromptSubmit): segura 1x o primeiro
  prompt depois de 55 min parado com >80k de contexto e injeta um lembrete em 120k/160k/200k.
  Numa análise de 30 dias, turnos >250k foram 71% do gasto e 64 retomadas com cache frio
  custaram 33,5M tokens-eq. `MURI_GUARDA=0` desliga.
- **Status line**: cor do contexto segue os tokens (amarelo 120k, vermelho 200k) e mostra quanto
  falta pro cache esfriar, com as mesmas regras do guarda.
- **Notificação** (`hooks/notify.mjs`, Notification): alerta no desktop no macOS/Linux quando o
  Claude espera você. `MURI_NOTIFY=0` desliga; pula sozinho dentro do Orca.
- `scripts/faxineiro.sh`: mata `agy` headless e worker da nota viva presos (ver
  [docs/background-jobs.md](./docs/background-jobs.md)).
- `settings.snippet.json` ganhou `_recomendado`: `autoCompactWindow` 250k, `askUserQuestionTimeout`
  10m, attribution vazio e `permissions.ask` pra comandos destrutivos de git/rm.
- `CLAUDE.md.template`: como reagir ao `[guarda-contexto]` e `chrome-headless-shell` pra print em script.
- `muri-delegate`: o delegado fecha com `STATUS: DONE|DONE_WITH_CONCERNS|BLOCKED|NEEDS_CONTEXT`,
  mostrado no cabeçalho e gravado como última coluna do `.delegations.log`.
- `muri-delegate`: o Codex delegado sobe sem os MCPs do `config.toml`; `--mcp` mantém o comportamento antigo.
- Skill: molde de brief (Objetivo · Pronto quando · Pode tocar · Não toque · Check) e três playbooks
  (scout-then-build, cascade, review gate). Ideias adaptadas do
  [alethe-orchestrate-skill](https://github.com/Kc1t/alethe-orchestrate-skill).

### Documentação
- READMEs, INSTALL, arquitetura e troubleshooting cobrem o guarda, a notificação, o faxineiro e o
  bloco `_recomendado`; prints regerados (status line com o segmento do guarda, instalador 3.2.0,
  diagrama de arquitetura).
- `tools/build-assets.mjs` prefere o `chrome-headless-shell` do PATH ao Chrome completo, e o
  `ansi-to-svg` entende cores de 256 (`38;5;N`/`48;5;N`).
- Badge e menções ao CI saem do README e da arquitetura enquanto o workflow está pausado.
- Vídeo de apresentação (90 s) e seis quadros dele no README.
- README novo, em pt e en: banner, gráfico da cota e cartão dos achados gerados de
  `assets/readme/dados.json` por `tools/build-readme.mjs` (claro e escuro). Opções do instalador,
  comandos e configuração foram para `docs/reference.md` e `docs/reference.en.md`.

### Corrigido
- Modelo da narrativa: `gemini-3.1-pro-high` saiu do `agy` (toda narrativa falhava). A cadeia
  padrão agora é `agy:gemini-4-argon-high` → `agy:gemini-3.8-flash-high` → `gemini-api:gemini-2.5-flash`.

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

## [2.1.0] — 2026-10-02

- Skills em inglês com núcleo curto e referências sob demanda.
- Templates globais de ~59 KB para ~8 KB.
- Comando `audit` somente leitura (tokens observados, tamanho das instruções,
  chamadas repetidas).
- ZIPs reproduzíveis das skills para marketplaces.

## [2.0.0] — 2026-09-25

- Vault, fuso e alias configuráveis em `~/.claude/muri-saver.json`.
- Máscara de segredos no hook e no ingestor.
- `--update`, `--uninstall`, manifesto com sha256.
- Ingestor lendo o SQLite do Codex, pulando subagentes, `--enrich` opcional.
- Suíte `node --test` e CI em macOS, Linux e Windows.

[Unreleased]: https://github.com/murilolol/muri-saver/compare/v3.2.0...HEAD
[3.2.0]: https://github.com/murilolol/muri-saver/compare/v3.1.0...v3.2.0
[3.1.0]: https://github.com/murilolol/muri-saver/compare/1f462ed...v3.1.0
[2.1.0]: https://github.com/murilolol/muri-saver/compare/v2.0.0...1f462ed
[2.0.0]: https://github.com/murilolol/muri-saver/releases/tag/v2.0.0
