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
- Fora do Windows, a busca pelo Python só lê o PATH, sem executar nada: no macOS sem Command Line
  Tools, `python3 --version` abria o diálogo de instalação das ferramentas a cada instalação,
  inclusive no `--dry-run` e no `--uninstall`.
- `"hooks": null` no `settings.json` não derruba mais a instalação no meio (o log do merge dava
  `TypeError` depois de copiar skills e hooks).
- A identidade de um hook é só o primeiro script do `command` (ou de `args`): um hook seu que cita
  o script do muri-saver como argumento (`node wrapper.mjs --target .../obsidian-vault-check.mjs`)
  não é mais trocado no merge nem removido no `--uninstall`. No Windows, `%USERPROFILE%` e caixa
  diferente (`C:/Users` × `c:/users`) também contam como o mesmo caminho.
- Uma `grill-me` de outro autor (ou editada por você) em `~/.claude/skills` fica como está, com
  aviso no log; nesse caso, a do muri-saver vai só para `~/.agents/skills`.

### Guarda de contexto, status line e usage-status
- Limiares proporcionais ao ponto de auto-compact, no lugar de 80k e 120k/160k/200k fixos. Ponto =
  `autoCompactWindow` limitado à janela do modelo, menos ~33k (sem valor, a janela inteira: ~967k
  com 1M, ~167k com 200k). O guarda avisa em 70% e 90% do ponto e segura o cache frio acima de 40%
  dele. Quem não tem `autoCompactWindow` e usa modelo de 1M passa a ver os avisos bem mais tarde,
  perto de onde o Claude Code compacta de fato.
- A janela vem do `context_window_size` do payload da status line, que a grava num cache
  (`~/.claude/hooks/.guarda-contexto-janela.json`) para o guarda, que não a recebe. Sem esse cache
  (status line sua no lugar da do muri-saver), o guarda supõe 200k, que erra para o lado seguro, e
  só passa a 1M quando o contexto já passou de 200k ou o modelo tem `[1m]`. Supor 1M desligava o
  guarda na prática para quem usa modelo de 200k: ponto em 967k, tudo acima da janela.
- O ponto de compactação tem piso na metade da janela efetiva: com `autoCompactWindow` ≤ 33k ele
  dava zero ou negativo, a status line caía no fallback (`ZeroDivisionError`) ou mostrava
  `1k/-13000`, e o guarda contava qualquer contexto como frio.
- Os marcos já avisados ficam guardados como fração do ponto (0,7/0,9), não em tokens: se o ponto
  muda na sessão (cache da janela gravado depois do 1º prompt, `/autocompact`), o aviso não repete.
- O `autoCompactWindow` do modelo em `modelSettings`, onde o `/autocompact` grava, vence o global.
- `compact_boundary` no transcript (inclusive o idle compaction): vale o `postTokens`, e o guarda
  deixa de segurar por "cache frio" com o contexto de antes da compactação.
- TTL do cache lido do transcript: se o último turno só gravou cache de 5 min (API, créditos,
  nuvem), o guarda só avisa (`systemMessage`), sem segurar, e a status line conta 5 min.
- Aviso do semanal (cache do `~/.claude.json`) em 70% e de novo em 90%, uma vez por sessão, com o
  % arredondado como no `usage-status` (antes, `72.4%`).
- Status line: o % e a barra são sobre o ponto de compactação (`161k/467k`), com as cores e dicas
  nos mesmos 70% e 90% do guarda. "compacta em Nk" só aparece quando N vem da janela ou do
  `autoCompactWindow`, nunca o "250k" fixo de antes.
- Estado do guarda ao lado do hook instalado, com `~/.claude` de fallback quando roda de um checkout
  do repo; gravação atômica, e o aviso sai antes de gravar.
- `usage-status.py`: fuso do `MURI_SAVER_TZ` ou do `muri-saver.json` (antes, Brasília fixo); sem a
  chave `cachedUsageUtilization` mostra "sem dado" em vez de `KeyError`; % fracionário arredondado
  (antes, `ValueError`); "plano sem janela 5h (so semanal)" quando só o semanal vem preenchido.
- Status line: a branch aparece também em worktree (o `.git` é um arquivo `gitdir:`), e o `*` vem
  de `git status --porcelain -uno` (mudança rastreada de verdade) no lugar da comparação de mtime
  entre o index e o HEAD, que errava nos dois sentidos.

### Perfil de plano
- `hooks/plan-profiles.json` com os perfis `pro`, `max`, `ultra`, `team`, `enterprise`, `api` e
  `auto`. Cada perfil escolhe só o `autoCompactWindow` (Pro 250k, Max 400k, Ultra 500k, Team 250k,
  Enterprise 300k, API 250k); os avisos seguem em 70% e 90% do ponto de compactação. Só o 250k do
  Pro tem base medida; os outros estão marcados como palpite. Nomes atuais: o Max 5x virou Max e o
  Max 20x virou Ultra (30/10/2026).
- Instalador: `--plan <perfil>` grava `plan` no `muri-saver.json`; perfil inválido ou sem valor
  para com exit 1 sem escrever nada (`__proto__` e `constructor` também não são perfis). Sem
  `--plan`, vale o salvo; sem nada salvo, o plano é detectado em cascata (`claude auth status`,
  `claude auth status --text`, `~/.claude.json`) e, se nada responder, fica `auto`, que mantém o
  comportamento de hoje e não fica salvo: o próximo `--update` detecta de novo. Deslogado ou com
  token avulso (`authMethod` `none`/`oauth_token`), também fica `auto`; o JSON vale mesmo com o
  exit 1 que o `claude auth status` dá deslogado (antes caía no `oauthAccount` antigo do
  `~/.claude.json`). Sem `~/.claude.json`, o Claude Code nunca rodou ali e a detecção nem chama
  o `claude`, que criaria a config dele no HOME: o `--dry-run` e o `doctor` não escrevem nada.
- `--apply-compact` grava o `autoCompactWindow` do perfil no `settings.json` global, só se não houver
  valor seu (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`, `modelSettings` ou o global). O valor que o
  muri-saver gravou acompanha uma troca de perfil, e o `--uninstall` o remove enquanto não for
  editado.
- `doctor`: linha "plano do Claude" com o perfil salvo, o `autoCompactWindow` e os avisos dele e o
  plano detectado. Dá AVISO quando o perfil salvo difere do plano detectado (com o
  `--update --plan`) e quando o `autoCompactWindow` que o muri-saver gravou ficou com o perfil
  anterior depois de um `--plan` sem `--apply-compact` (com o `--update --apply-compact`).
- Teste confere que os marcos e a folga do `plan-profiles.json` são os do `guarda-contexto.py`.

### Jobs e backfill
- `--with-jobs` sem o binário do ai-memory deixa `finalize-idle`, `reprocess-parked` e `llm-shim`
  de fora e diz como incluí-los depois. Um `MURI_SAVER_AI_MEMORY_BIN` que aponta para um arquivo
  que não existe conta como ausente.
- No macOS, o instalador lista os LaunchAgents antigos `com.muri.*` que fazem o mesmo que um job
  pedido (o prefixo `ai-memory-` conta; o faxineiro, sem equivalente, fica de fora) e mostra o
  `launchctl bootout` e o `mv ... .disabled` de cada um. Ele só mostra: não roda nada.
- `vault-backfill`: nota apagada do vault sai da fila e vai para as falhas sem chamar modelo (antes
  o `readFileSync` derrubava a rodada). Rodadas que param no limite são contadas (`stuckRounds`,
  zera a cada narrativa nova); com 36 seguidas (~3 dias) o job se desativa, porque aí é a cadeia
  quebrada e não a cota.
- Nota viva: o lock do worker vale o orçamento da cadeia (20 min) mais 10 min do último elo e é
  renovado a cada passada; antes expirava em 12 min, com a cadeia ainda rodando, e o Stop seguinte
  abria um segundo worker. O faxineiro só mata o worker com mais de 1 h
  (`FAXINA_WORKER_MAX_AGE_S`, duas passadas); o teto do `agy` continua 15 min.
- Faxineiro: o cabeçalho diz macOS/Linux (sem Windows) e sai a menção ao LaunchAgent e ao teste
  que só existiam numa máquina.
- `muri-delegate`: cota só pela mensagem de erro do `agy` e pelas últimas 15 linhas do stderr. O
  log inteiro trazia o brief e a conversa, e uma tarefa que falava de cota dava falso exit 75.

### ai-memory
- `doctor`: o binário é achado como nos scripts (PATH, `~/.local/bin`, `~/.cargo/bin` ou
  `MURI_SAVER_AI_MEMORY_BIN`) e mostra a versão; fora da 3.2.x dá AVISO. Um `SELECT ... LIMIT 0`
  nas colunas que `finalize-idle` e a ponte da nota viva leem confere o schema do SQLite: banco
  ausente, leitor ausente (sem `node:sqlite` nem `sqlite3`) e schema mudado viram avisos distintos.
- `doctor`: sem o ai-memory, o binário e o MCP `ai-memory` ausentes dão AVISO, não FALHA (o README o
  trata como opcional e os scripts já degradam sem ele). A linha do servidor só aparece com o binário.
- `doctor`: avisa quando o grupo `ai-memory` dos hooks do Antigravity perdeu o aim-guard (o
  `install-hooks --apply` e o `upgrade` do ai-memory reescrevem o grupo) e manda rodar `--update`.
- Ingestor: com a pasta da sessão ainda no disco, o `write-page` roda nela sem `--project`, e o
  próprio ai-memory resolve o projeto (repo-root/remote) como nos hooks. Antes ia o nome da pasta,
  que numa subpasta do repositório criava outro projeto. Sem a pasta, continua o nome dela.
- `ai-memory-obsidian-setup.md`: seção "Servidor, recuperação e upgrade" com o `ai-memory setup`
  (serviço de usuário; reescreve hooks, então `--update` depois), o `ai-memory recover` e o roteiro
  `backup` → `upgrade` → `--update` → `doctor`, mais a volta para a 3.2.0. Resumo no bloco em inglês.
  INSTALL-AI lista as checagens novas do `doctor`.

### Qualidade e skills
- Testes novos: `notify` (MURI_NOTIFY=0 e Orca não notificam, aspas saem da mensagem),
  `ai-memory-ensure-server` (nunca falha a sessão, avisa só quando ela começa na home), git da
  status line, links da SKILL.md para `references/` e formato de `evals/`.
- Os testes apagam os diretórios temporários ao sair (antes, dezenas ficavam no `$TMPDIR` a cada
  `npm test`).
- `--with-companion-skills` roda `npx -y skills@1.7.4 add` (CLI com versão fixa) e mostra o repo de
  origem de cada pacote.
- SKILL.md do muri-saver: cabeçalho na 3.2, sem a repetição do template (guarda) nem da
  `delegation.md` (os playbooks foram para a referência), gatilhos "se instalada" e a dica de
  `skillOverrides` na revisão periódica.

### Documentação
- README pt/en: seção "Plano do Claude e contexto" (a janela vem do modelo, o plano define a cota,
  o perfil ajusta só o `autoCompactWindow`), com a tabela de cotas e os nomes novos.
- INSTALL-AI: as perguntas "Plano" (o detectado como recomendado) e "Compactar em" no passo 0, no
  estilo da `grill-me`. A pergunta do fuso saiu: o fuso detectado vai para o resumo e o
  `--timezone` só entra se o usuário corrigir.
- SKILL.md e referência sem os números fixos (`autoCompactWindow: 250000`, 55 min): falam do
  perfil do plano e do aviso `[guarda-contexto]`.
- `npx muri-saver` (o pacote não existe no npm) vira `node bin/cli.mjs` em READMEs, INSTALL,
  INSTALL-AI, docs e help do CLI; a rota sem clonar usa `npx github:murilolol/muri-saver`.
- Dica final do instalador (passo 6) e nota dos READMEs sobre `report`/`audit` também com
  `node bin/cli.mjs`, que funciona num clone sem nada no PATH.
- `docs/skills-companion.md`: seções "Versão fixa do CLI" e "Podar o que você não usa
  (`skillOverrides`)", com os quatro valores e o menu `/skills`; os READMEs linkam para ela.
- `docs/evaluation.md`: diz que `evals/` não tem runner (cada cenário precisa de modelo e avaliador)
  e roda pelo `skill-creator` ou à mão.
- Instalador e `settings.snippet.json`: a dica do ai-memory leva `--apply` e soma
  `install-mcp --client claude-code --session-aware --apply`; com Codex ou Antigravity detectados,
  cita `--agent codex`/`antigravity-cli` e o `--update` que religa o aim-guard.
- `skills-companion.md`: link do OpenSpec (`Fission-AI/OpenSpec`), colisão do `prototype`
  (Matt Pocock × Emil Kowalski), status de `emil-design-eng` e `taste-skill`, nota do superpowers.
- "Testado com o ai-memory 3.2.x" no INSTALL e no guia do ai-memory.
- README pt/en: bloco "Instalar em 1 minuto" no topo, com requisitos e "0 dependências npm";
  `evaluation.md` e `marketplace.md` entram na tabela de documentação.
- CHANGELOG: `[Unreleased]`, datas da 2.0.0 e da 2.1.0 e links de comparação.
- READMEs pt/en, `CLAUDE.md.template`, `settings.snippet.json`, `architecture`, `economy-report`,
  `troubleshooting` e a SKILL.md descrevem o guarda e a status line proporcionais.
- README pt/en: o vídeo narrado de 77 s entra no lugar do antigo "sem narração", com aviso de que
  o player do GitHub começa mudo, link de reserva e transcrição em `<details>` (em inglês no README
  en, que avisa que a narração é em português). A seção vira "Em 77 segundos"/"In 77 seconds" e a
  âncora `#em-90-segundos`, usada na release v3.2.0, continua funcionando.
- Grade de quadros do vídeo novo em `assets/video/*.jpg` (status line, guarda, `/compact`,
  ai-memory, delegação e nota no Obsidian), no lugar dos PNG do vídeo antigo.
- "Onde a cota vai": sai o "perto de 11 pontos da cota semanal", que não batia com a calibração do
  relatório de economia (1% ≈ 1,3M tokens-eq daria uns 26) e não dizia o plano; o texto aponta a
  calibração do `report`. A fonte do 2,1 bi de tokens de cache entra no `dados.json`.
- README pt/en: seção "Skills que eu uso junto", com a fonte de cada skill e o link para
  [murilolol/muri-skills](https://github.com/murilolol/muri-skills).
- README pt/en: "Skills que eu uso junto" aponta para `docs/skills-companion.md` e para o
  `--with-companion-skills`, que continuam sendo a fonte das companheiras.
- `tools/build-readme.mjs`: o total de turnos, o 71% e o ~2,5× saem do `dados.json`, sem número
  escrito à mão (os SVGs gerados não mudam).

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
