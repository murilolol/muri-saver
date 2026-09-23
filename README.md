<h1 align="center">muri-saver</h1>

<p align="center"><em>Governança de tokens, memória persistente e registro humano-legível para agentes de IA — Claude Code, Codex e Antigravity. O setup que eu uso todo dia, documentado pra qualquer um instalar.</em></p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-compatible-D97757?style=flat-square&logo=anthropic&logoColor=white" alt="Claude Code" />
  <img src="https://img.shields.io/badge/Codex-compatible-10A37F?style=flat-square&logo=openai&logoColor=white" alt="Codex" />
  <img src="https://img.shields.io/badge/Antigravity%2FGemini-compatible-4285F4?style=flat-square&logo=googlegemini&logoColor=white" alt="Antigravity / Gemini CLI" />
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A518-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Python-3-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python 3" />
  <img src="https://img.shields.io/badge/ai--memory-MCP-6E56CF?style=flat-square&logo=sqlite&logoColor=white" alt="ai-memory" />
  <img src="https://img.shields.io/badge/Obsidian-Vault-7C3AED?style=flat-square&logo=obsidian&logoColor=white" alt="Obsidian" />
  <img src="https://img.shields.io/badge/macOS_%7C_Linux_%7C_Windows-cross--platform-555?style=flat-square&logo=gnubash&logoColor=white" alt="Cross-platform" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

<p align="center">
  <a href="https://github.com/murilolol/muri-saver/stargazers"><img src="https://img.shields.io/github/stars/murilolol/muri-saver?style=flat-square&color=gold&label=stars" alt="GitHub stars" /></a>
  <a href="https://github.com/murilolol/muri-saver/commits/main"><img src="https://img.shields.io/github/last-commit/murilolol/muri-saver?style=flat-square&color=blue" alt="Last commit" /></a>
  <a href="https://github.com/murilolol/muri-saver/issues"><img src="https://img.shields.io/github/issues/murilolol/muri-saver?style=flat-square" alt="Open issues" /></a>
  <a href="https://github.com/murilolol/muri-saver/network/members"><img src="https://img.shields.io/github/forks/murilolol/muri-saver?style=flat-square&color=blueviolet" alt="Forks" /></a>
  <img src="https://img.shields.io/badge/zero_runtime_deps-bin%2F*.mjs-lightgrey?style=flat-square" alt="Zero runtime dependencies" />
</p>

<br>

> [!NOTE]
> **TL;DR** — `CLAUDE.md`/`GEMINI.md`/`AGENTS.md` (governança sempre
> carregada, um arquivo por agente) + skill `muri-saver` (modo de economia
> agressiva sob demanda, renomeável com `--alias`) + hooks de ciclo de vida
> que gravam sozinhos em [`ai-memory`](https://github.com/akitaonrails/ai-memory)
> (memória durável cross-sessão) e num vault do Obsidian (registro
> humano-legível). Instalação em 3 comandos, detecta o sistema operacional
> sozinho, funciona pra Claude Code, Antigravity e Codex ao mesmo tempo.

> [!TIP]
> **Vai instalar com ajuda de uma IA?** Mande o link deste repositório pro
> seu agente e peça pra ele seguir **[`INSTALL-AI.md`](./INSTALL-AI.md)** —
> um runbook escrito especificamente pra uma IA executar sozinha, que abre
> com uma entrevista `/grill-me` (nome/alias, quais agentes, importar
> histórico?) antes de tocar em qualquer arquivo, detecção de SO e
> verificação automática de cada peça no final.

<details>
<summary><strong>⚡ Instalação em 30 segundos</strong> (clique pra expandir)</summary>

```bash
git clone https://github.com/murilolol/muri-saver.git
cd muri-saver
node bin/install.mjs --dry-run   # revise o que seria feito, nada é escrito ainda
node bin/install.mjs --with-all  # Claude Code + Antigravity + Codex de uma vez
node bin/doctor.mjs              # verifica tudo automaticamente
```

Quer usar seu próprio nome em vez de `muri-saver`? `--alias mendes-saver`.
Já tinha sessões antigas de algum desses agentes? `node bin/ingest-sessions.mjs --all --dry-run`
depois de instalar. Detalhes de tudo isso mais abaixo, ou direto em
[Instalação](#instalação).
</details>

<br>

## Índice

- [Sobre](#sobre)
- [Como funciona](#como-funciona)
- [Status line](#status-line)
- [`ai-memory`](#ai-memory)
- [Antes / depois](#antes--depois)
- [Achados reais que justificam cada regra](#achados-reais-que-justificam-cada-regra)
- [O que tem aqui](#o-que-tem-aqui)
- [Skills incluídas](#skills-incluídas)
- [Instalação](#instalação)
- [Personalize com o seu nome (`--alias`)](#personalize-com-o-seu-nome---alias)
- [Importando sessões antigas (session ingestor)](#importando-sessões-antigas-session-ingestor)
- [Multiplataforma](#multiplataforma)
- [Perguntas rápidas](#perguntas-rápidas)
- [Documentação complementar](#documentação-complementar)
- [Autoria e créditos](#autoria-e-créditos)
- [Licença](#licença)

<br>

## Sobre

Uso Claude Code (e Codex/Antigravity em paralelo) todo dia pra vários
projetos ao mesmo tempo, e três problemas apareciam sempre:

1. **Custo e limite de uso descontrolados** — sessão maratona, releitura
   repetida do mesmo arquivo, screenshot de browser em vez de texto,
   subagente caro pra tarefa mecânica, effort alto aplicado por padrão a
   tudo.
2. **Memória que evapora entre sessões** — toda decisão, convenção e
   contexto de projeto tinha que ser reexplicado do zero de novo, sessão após
   sessão, mesmo quando o projeto era o mesmo de ontem.
3. **Nenhum registro legível por humano** do que a IA fez — só transcript
   bruto, impossível de navegar depois de algumas semanas, e impossível de
   mostrar pra outra pessoa sem rolar milhares de linhas de JSON.

Isso aqui nasceu de **auditar meu próprio histórico de uso** (transcripts
reais, não teoria de blog) pra achar os padrões que mais custavam caro, e
resolver os três problemas com um sistema, não uma lista solta de dicas.
Amigos meus pediram pra usar a mesma coisa depois de ver funcionando — este
repositório é esse setup, documentado e pronto pra instalar em outra
máquina.

Não é dogma nem "melhores práticas" genéricas. É o que funcionou pra mim,
com os números que provam por quê (seção
[Achados reais](#achados-reais-que-justificam-cada-regra)). Adapte pra sua
realidade — o `bin/doctor.mjs` existe pra você auditar a sua, não só confiar
na minha.

> [!TIP]
> **Isso é pra você se:** você já bateu teto de uso sem entender por quê;
> reexplica o mesmo contexto de projeto toda sessão nova; troca entre Claude
> Code/Codex/Antigravity e perde continuidade a cada troca; ou só quer um
> jeito de olhar pra trás e ver o que a IA fez num projeto sem abrir um
> transcript JSON de 40 mil linhas.

<br>

## Como funciona

Quatro peças, cada uma resolvendo uma parte diferente do problema — a
governança roda sempre e é barata, o resto liga sob demanda ou em segundo
plano:

| Peça | Arquivo(s) | Quando roda | Resolve |
|---|---|---|---|
| **Governança global** | `CLAUDE.md` / `GEMINI.md` / `AGENTS.md` (um por agente) | Toda sessão, todo projeto | Regras curtas e universais: consultar memória antes de reler arquivo, alocação de modelo por subagente, proteções de git, mapa de palavras-chave pra não varrer diretório às cegas |
| **Skill `muri-saver`** | `skills/muri-saver/SKILL.md` | Sob demanda ("muri saver" ou pedido explícito de economia) | Lista longa e agressiva de regras por tipo de tarefa (backend, frontend, browser automation, git, debug...) — cara demais pra deixar sempre carregada |
| **Hooks de ciclo de vida** | `hooks/*.mjs` | `SessionStart` / `Stop`, automático | Memória e registro acontecem **sempre**, sem depender do agente lembrar — a versão anterior dependia de uma regra escrita no `CLAUDE.md` e parava de ser seguida depois de alguns dias sem enforcement real |
| **`ai-memory` + Obsidian Vault** | daemon externo + `<vault>/` | Consultado/gravado pelos hooks | Destino final: banco SQLite/FTS5 via MCP como fonte de verdade durável, e vault Markdown como vitrine legível por humano — gerado pelos hooks, nunca escrito à mão |

<p align="center">
  <img src="./assets/architecture-diagram.png" alt="Diagrama: Claude Code, Codex e Antigravity alimentam o CLAUDE.md e a skill muri-saver, que acionam hooks de SessionStart/Stop, que gravam em ai-memory e no Obsidian Vault" width="100%" />
</p>

Ciclo de vida de uma sessão, na prática:

```mermaid
sequenceDiagram
    participant U as Usuario
    participant CC as Claude Code
    participant H as Hooks
    participant AM as ai-memory
    participant V as Obsidian Vault

    U->>CC: abre uma sessao
    CC->>H: SessionStart
    H->>AM: garante servidor de pe + busca handoff
    AM-->>CC: contexto da sessao anterior
    U->>CC: trabalha (prompts, edicoes, tool calls)
    CC->>H: Stop (fim da sessao)
    H->>AM: grava observacoes + handoff novo
    H->>V: gera Daily + nota de sessao
    AM-->>V: alimenta taxonomia por projeto
```

Isso roda em **toda** sessão, mesmo as curtas — sessões muito triviais
recebem só um registro barato (sem custo de LLM), nunca são silenciosamente
ignoradas. Decisões de design completas, e por que a arquitetura é separada
assim (e não tudo num arquivo só), em
[`docs/architecture.md`](./docs/architecture.md).

<br>

## Status line

`scripts/statusline.py` é a status line que uso todo dia no Claude Code —
mesmo motor visual (barras, cor por limiar, dicas proativas) do renderizador
que uso no Antigravity (`~/.gemini/scripts/usage-status.py`), pra manter a
leitura consistente entre os agentes. Exemplo real, exatamente como aparece
no meu terminal:

```
📁 muri-saver │ 🌿 main* │ 🧠 on │ ⏱ 1m 46s │ ◔ 170k/1m ▓░░░░░░░ 17% → considere /compact │ 5h ▓░░░░░░░ 9% → 3h 41m │ 7d ░░░░░░░░ 0% → 167h 01m │ ◆ Sonnet 5
```

| Segmento | Significado |
|---|---|
| `📁 muri-saver` | Diretório do projeto atual |
| `🌿 main*` | Branch git (`*` = mudanças não commitadas) |
| `🧠 on` | Servidor local do `ai-memory` respondendo (`off` em cinza se não estiver) |
| `⏱ 1m 46s` | Duração da sessão atual |
| `◔ 170k/1m ▓░░░░░░░ 17% → considere /compact` | Tokens de contexto usados / janela total, barra proporcional, e dica que escala em 4 níveis (`tranquilo` → `acompanhe o contexto` → `considere /compact` → `/compact ou /clear agora`) |
| `5h ▓░░░░░░░ 9% → 3h 41m` | % da janela de uso de 5h e contagem regressiva até o reset |
| `7d ░░░░░░░░ 0% → 167h 01m` | % da janela semanal e contagem regressiva |
| `◆ Sonnet 5` | Modelo ativo na sessão |

Cor muda por limiar (branco → amarelo em 70% → vermelho em 90%) em qualquer
barra de porcentagem, e o layout se adapta sozinho pra terminal estreito
(<120 colunas), caindo pra só números sem barra. Instalado automaticamente
pelo `bin/install.mjs` via `claude-config/settings.snippet.json` (chave
`statusLine`) — só não mexe se você já tiver um `statusLine` customizado no
seu `settings.json`. O Codex CLI tem status line própria embutida no TUI (não
scriptável do mesmo jeito), por isso não tem uma versão equivalente deste
arquivo aqui — a consistência visual hoje é entre Claude Code e Antigravity.

<br>

## `ai-memory`

Quem resolve o problema #2 da seção [Sobre](#sobre) (memória que evapora
entre sessões) é o **[ai-memory](https://github.com/akitaonrails/ai-memory)**
— um projeto externo, não é meu, mas é a peça central deste setup.

**O que é:** um servidor de memória de longo prazo pra agentes de IA
coding, criado por [Fabio Akita](https://github.com/akitaonrails) (mais de
8 mil estrelas no GitHub, licença MIT, escrito em Rust). A ideia central:
seu agente já tem alguma memória hoje — Claude Code anota algumas coisas,
Cursor lembra outras — mas ela fica presa numa máquina, num agente só, e
some quando você troca de ferramenta. O ai-memory fica do outro lado dessas
paredes:

- **Atravessa agentes** — mais de 20 harnesses (Claude Code, Codex, Cursor,
  Gemini CLI, OpenCode, Grok, Devin...) alimentam a mesma memória
  compartilhada. Sai do Claude Code no meio de uma tarefa, abre o Codex no
  mesmo diretório, e o próximo agente recebe um handoff de verdade — o que
  já foi tentado, o que falhou, o que ainda tá em aberto.
- **Atravessa máquinas** — a memória vive num servidor local (o mesmo
  notebook, uma homelab, o que for); o projeto que você deixou no desktop é
  o mesmo que retoma no notebook.
- **É markdown puro** — a fonte de verdade é uma wiki versionada de
  arquivos `.md` comuns; o banco (SQLite + FTS5) é um índice derivado que
  sempre pode ser reconstruído a partir dos arquivos. `grep`, abra no
  Obsidian, edite à mão — sem vector store pra manter, nada preso num blob
  binário.
- **Captura o trabalho sozinho** — hooks de ciclo de vida gravam prompts,
  tool calls e limites de sessão, sanitizados antes de guardar, sem
  cerimônia de "lembra disso". O caminho padrão usa **zero chamadas de
  LLM** — captura, busca e handoff funcionam sem nenhuma API key.

Neste repositório, `hooks/ai-memory-ensure-server.mjs`,
`hooks/obsidian-vault-check.mjs` e o `CLAUDE.md.template` já vêm
configurados pra usar o ai-memory como essa fonte de verdade — não preciso
reescrever nada disso, só integrar. Instalação completa (binário, MCP
session-aware, marker file por projeto, provedor de LLM opcional) em
[`docs/ai-memory-obsidian-setup.md`](./docs/ai-memory-obsidian-setup.md).

<br>

## Antes / depois

| | Sem muri-saver | Com muri-saver |
|---|---|---|
| **Início de sessão** | Reexplicar contexto do projeto do zero | Hook `SessionStart` injeta handoff da sessão anterior via `ai-memory` |
| **Fim de sessão** | Nada registrado, ou registro manual esquecido | Hook `Stop` grava sozinho em `ai-memory` + Obsidian Vault |
| **Reler arquivo grande** | Toda vez que a dúvida aparece de novo | `memory_query` primeiro — arquivo lido 30-54x vira 1x |
| **Automação de browser** | Screenshot pra tudo, mesmo pra "cliquei certo?" | Texto (`get_page_text`) por padrão; screenshot só quando é visual de verdade |
| **Effort do modelo** | `xhigh` fixo pra tudo, inclusive tarefa mecânica | Escalonado por tipo de tarefa/subagente |
| **`/loop` dinâmico** | Roda sozinho indefinidamente | Confirmação explícita antes de deixar reagendar sozinho |
| **Histórico do projeto** | Preso em transcripts JSON ilegíveis | Vault Obsidian navegável, taxonomia por categoria |
| **Sessão longa demais** | Vira maratona de horas/dias sem perceber | Sugestão ativa de `/compact`/`/clear` + handoff automático |

<br>

## Achados reais que justificam cada regra

Duas auditorias completas do meu próprio histórico (transcripts reais, não
suposição) alimentam a skill `muri-saver` e o `CLAUDE.md`:

| Achado | Números reais |
|---|---|
| Sessão maratona é o maior vilão de custo — não escolha de modelo | Uma sessão sozinha consumiu **2,1 bilhões de tokens de cache** em 42h / 7.059 mensagens |
| Releitura repetida do mesmo arquivo | Um arquivo lido **30 a 54 vezes** na mesma sessão |
| Screenshot em vez de texto em automação de browser | **501 chamadas de `computer` (screenshot)** contra **3 de `get_page_text`/`read_page`** no mesmo intervalo de sessões |
| Effort alto (`xhigh`) aplicado por padrão a tudo | Inclusive tarefas mecânicas/triviais que não precisavam |
| Loop dinâmico sem confirmação | 4 loops dinâmicos consumiram **~28,2 milhões de tokens** juntos num único `/usage` |
| Ferramentas de browser recarregadas à toa | Até 8-9 recargas do mesmo conjunto de tool schemas numa única sessão longa |

Cada linha da tabela virou uma regra específica e testável na skill
(`skills/muri-saver/SKILL.md`) ou no `CLAUDE.md.template` — não teoria
importada de outro lugar. Isso significa também que, se **sua** rotina de
uso for diferente da minha, algumas regras podem não fazer sentido — audite
a sua própria e ajuste (é literalmente pra isso que a skill recomenda rodar
`/doctor` periodicamente).

<br>

## O que tem aqui

<details open>
<summary><strong>📂 Estrutura completa do repositório</strong> (clique pra recolher)</summary>

```
muri-saver/
├── package.json                       # metadata + scripts npm de conveniencia
├── bin/
│   ├── install.mjs                    # instalador nao-interativo, detecta o SO, suporta --alias/--with-*
│   ├── doctor.mjs                     # verificacao de ambiente (Node/Python/ai-memory/MCP/Obsidian/vault/agentes)
│   └── ingest-sessions.mjs            # importa sessoes antigas de cada agente pro vault/ai-memory, sem LLM
├── assets/
│   ├── architecture-diagram.png       # diagrama usado neste README
│   └── architecture-diagram.svg       # fonte vetorial editavel do diagrama
├── skills/
│   ├── muri-saver/SKILL.md            # minha skill original — modo de economia agressiva
│   ├── grill-me/SKILL.md              # minha reescrita do protocolo de entrevista via modal nativo
│   └── companion/                     # NAO sao skills vendorizadas — so README explicando cada uma
│       ├── find-skills/README.md      # + tdd/, prototype/, grill-with-docs/, openspec/,
│       └── ...                        #   graphify/, impeccable/, emil-design-eng/, taste-skill/
├── claude-config/
│   ├── CLAUDE.md.template             # governanca global do Claude Code, sempre carregada
│   └── settings.snippet.json          # trecho de merge pro ~/.claude/settings.json
├── antigravity-config/
│   ├── GEMINI.md.template             # governanca global do Antigravity/Gemini CLI (equivalente ao CLAUDE.md)
│   └── hooks.snippet.json             # trecho de merge pro ~/.gemini/config/hooks.json
├── codex-config/
│   ├── AGENTS.md.template             # governanca global do Codex CLI (equivalente ao CLAUDE.md)
│   └── hooks.snippet.json             # trecho de merge pro ~/.codex/hooks.json
├── hooks/
│   ├── obsidian-vault-check.mjs       # Stop: grava a sessao no vault (Claude Code/Antigravity)
│   ├── ai-memory-ensure-server.mjs    # SessionStart: garante o daemon do ai-memory de pe
│   └── codex/
│       └── obsidian-codex-session.mjs # mesma funcao, pro Codex CLI
├── scripts/
│   ├── usage-status.py                # status de uso/limite formatado pt-BR
│   ├── statusline.py                  # status line completa (contexto, quota, git)
│   ├── ai-memory-llm-mode.sh          # alterna provedor de LLM do ai-memory (macOS/Linux)
│   ├── ai-memory-llm-mode.ps1         # idem, Windows/PowerShell
│   └── test-vault-hooks.sh            # smoke test dos hooks contra HOME fake
├── mcp/
│   └── mcp-servers.example.json       # entradas MCP (ai-memory + Obsidian)
├── docs/
│   ├── architecture.md                # por que cada peca existe e como se encaixam
│   ├── ai-memory-obsidian-setup.md    # instalacao detalhada do ai-memory + Obsidian
│   ├── session-ingestor.md            # formato de cada fonte, sanitizacao e idempotencia do ingestor
│   └── skills-companion.md            # skills de terceiros que uso, com creditos e vantagens
├── README.md
├── INSTALL.md                         # guia curto pra humano
├── INSTALL-AI.md                      # runbook completo pra uma IA instalar sozinha (com onboarding /grill-me)
└── LICENSE
```

</details>

<br>

## Skills incluídas

### As minhas

Código-fonte completo vendorizado aqui, sob a mesma licença MIT deste
repositório:

| Skill | Descrição |
|---|---|
| [`muri-saver`](./skills/muri-saver/SKILL.md) | Modo de economia agressiva de tokens/custo/limites — a skill central deste repositório, nascida de auditoria real de uso |
| [`grill-me`](./skills/grill-me/SKILL.md) | Minha reescrita completa do protocolo de entrevista de requisitos, forçando o modal nativo `AskUserQuestion`/`ask_question` em vez de texto cru no chat |

### Skills companheiras (de terceiros)

Uso todo dia, mas **não são copiadas aqui de propósito** — são projetos de
terceiros, com seus próprios autores e licenças, e uma cópia local só ficaria
desatualizada. Cada uma tem uma página dedicada em
[`skills/companion/`](./skills/companion/) — não com o código da skill, mas
com uma explicação própria (o que é, quando eu uso, vantagem, comando de
instalação). Prévia rápida:

| Skill | O que faz | Autor | Licença |
|---|---|---|---|
| [`find-skills`](./skills/companion/find-skills/README.md) | Descobre e instala outras skills do ecossistema aberto (`skills.sh`) | [Vercel Labs](https://github.com/vercel-labs/skills) | MIT |
| [`tdd`](./skills/companion/tdd/README.md) | Referência de test-driven development — loop red→green, o que é um bom teste, anti-padrões | [Matt Pocock](https://github.com/mattpocock/skills) | MIT |
| [`prototype`](./skills/companion/prototype/README.md) | Protótipo descartável pra validar modelo de estado/lógica ou layout antes de construir de vez | [Matt Pocock](https://github.com/mattpocock/skills) | MIT |
| [`grill-with-docs`](./skills/companion/grill-with-docs/README.md) | Entrevista tipo `grill-me` que também gera ADR/glossário como efeito colateral | [Matt Pocock](https://github.com/mattpocock/skills) | MIT |
| [`openspec`](./skills/companion/openspec/README.md) | Framework de especificação estruturada (requisitos, arquitetura, plano de execução) antes de implementar | [openspecio](https://github.com/openspecio/openspec) | MIT |
| [`graphify`](./skills/companion/graphify/README.md) | Transforma qualquer pasta de código/docs num grafo de conhecimento navegável (`graphify query/path/explain`) | [safishamsi](https://github.com/Graphify-Labs/graphify) | Apache-2.0 |
| [`impeccable`](./skills/companion/impeccable/README.md) | Revisão/crítica/polish de UI com padrão de design director sênior | [Paul Bakaus](https://github.com/pbakaus/impeccable) | Apache-2.0 |
| [`emil-design-eng`](./skills/companion/emil-design-eng/README.md) (pack) — *quero usar* | Revisão de animação e UI polish com o critério de quem construiu Vaul e Sonner | [Emil Kowalski](https://github.com/emilkowalski/skills) | MIT |
| [`taste-skill`](./skills/companion/taste-skill/README.md) — *quero usar* | Dá "bom gosto" visual à IA a partir de referências reais, evita interface genérica | [Leonxlnx](https://github.com/Leonxlnx/taste-skill) | MIT |

Índice completo com mais contexto (quando usar, por que vale a pena) em
[`docs/skills-companion.md`](./docs/skills-companion.md). Avaliei o pacote
`obra/superpowers` e decidi não usar — é ótimo, mas pesado demais em
tokens/contexto pro meu fluxo (o oposto do que este repositório propõe).

> [!TIP]
> **`grill-me` e `grill-with-docs` são usadas juntas, não uma no lugar da
> outra**: `grill-me` (minha, sempre instalada) é o padrão do dia a dia;
> `grill-with-docs` (de terceiros, opcional) é o upgrade só pra quando a
> decisão é grande o bastante pra virar ADR permanente. Comparação completa
> em [`docs/skills-companion.md`](./docs/skills-companion.md#grill-me-vs-grill-with-docs--uso-as-duas-pra-situações-diferentes).

<br>

## Instalação

```bash
git clone https://github.com/murilolol/muri-saver.git
cd muri-saver
node bin/install.mjs --dry-run   # revise o que seria feito
node bin/install.mjs             # instala de verdade (só Claude Code)
node bin/install.mjs --with-all  # ou: Claude Code + Antigravity + Codex de uma vez
node bin/doctor.mjs              # verifica tudo automaticamente
```

Guia completo — pré-requisitos, `ai-memory`, MCP, plugin `claude-obsidian`,
verificação — em [`INSTALL.md`](./INSTALL.md) (humano) ou
[`INSTALL-AI.md`](./INSTALL-AI.md) (pra uma IA seguir sozinha, com onboarding
interativo via `/grill-me`).

<br>

## Personalize com o seu nome (`--alias`)

`muri-saver` é o nome padrão, mas não é obrigatório. Qualquer dev que clone
este repositório pode instalar sob o próprio nome ou apelido — útil se você
(ou um colega, tipo Mendes ou Lucas) quer adotar o mesmo sistema sem ficar
digitando "muri saver" pra ativar algo que não é seu:

```bash
node bin/install.mjs --alias mendes-saver --author-name Mendes
# ou, sem sufixo -saver:
node bin/install.mjs --alias lucas
```

Isso renomeia a skill (`~/.agents/skills/<alias>/SKILL.md`) e reescreve todos
os gatilhos de ativação nos templates de governança (`CLAUDE.md`/`GEMINI.md`/`AGENTS.md`)
— `"mendes saver"`, `"mendes-saver"`, `"/mendes-saver"` — mantendo
`"muri-saver"`/`"muri saver"` funcionando como alias alternativo herdado do
padrão original, então nada quebra se você misturar os dois nomes por hábito.
`--author-name` é só cosmético, aparece no log da instalação.

<br>

## Importando sessões antigas (session ingestor)

Já usava Claude Code, Antigravity ou Codex antes de instalar isto? O
`bin/ingest-sessions.mjs` varre o histórico local de cada agente e registra
retroativamente no Obsidian Vault e/ou no `ai-memory` — **sem chamar nenhuma
LLM** (extração 100% local; ver [`docs/session-ingestor.md`](./docs/session-ingestor.md)
pro porquê disso importar):

```bash
# Simulação — lista o que seria importado, não escreve nada
node bin/ingest-sessions.mjs --all --dry-run

# Ingestão real, com limite (bom pra primeira vez)
node bin/ingest-sessions.mjs --all --limit 20

# Só um agente
node bin/ingest-sessions.mjs --agent antigravity
```

```mermaid
graph TD
    CC["🟧 Claude Code"]
    AGY["🤖 Antigravity"]
    CDX["🧩 Codex"]
    Ing["📥 Ingestor de Sessoes"]
    AM["🧠 ai-memory"]
    V["📚 Obsidian Vault"]

    CC --> Ing
    AGY --> Ing
    CDX --> Ing
    Ing --> AM
    Ing --> V
```

Idempotente (não duplica o que já foi importado), sanitiza segredos e tags de
sistema antes de gravar, e suporta `--file <conversations.json>` pra exports
avulsos do Claude Desktop/Web. Flags completas em
[`docs/session-ingestor.md`](./docs/session-ingestor.md).

<br>

## Multiplataforma

`bin/install.mjs`, `bin/doctor.mjs` e `bin/ingest-sessions.mjs` detectam o
sistema operacional sozinhos (`process.platform`: `darwin`/`linux`/`win32`) e
resolvem todo caminho relativo à home do usuário (`os.homedir()`) — nada de
`/Users/...` ou `C:\Users\...` hardcoded. `bin/doctor.mjs` inclusive adapta
onde procura o binário do `ai-memory` (`~/.local/bin` vs `~/.cargo/bin`) e o
app Obsidian (`/Applications`, `AppData\Local`, `/usr/bin`) por SO. Testado em
macOS; Linux e Windows seguem a mesma lógica de resolução de caminho — se algo
específico do seu SO quebrar, é bug, não limitação de design.

<br>

## Perguntas rápidas

<details>
<summary><strong>Preciso usar Claude Code, ou funciona com outra coisa?</strong></summary>

Não — `bin/install.mjs --with-all` configura Claude Code, Antigravity/Gemini
CLI e Codex CLI de uma vez, cada um com seu próprio arquivo de governança
(`CLAUDE.md`/`GEMINI.md`/`AGENTS.md`) e hook de gravação de sessão. Se seu
agente não é nenhum desses três, adapte os hooks — eles são só scripts
Node/Bash comuns, e os templates de governança são texto puro.
</details>

<details>
<summary><strong>Isso vai deixar minhas sessões mais lentas?</strong></summary>

Não deveria — a skill `muri-saver` existe justamente pra ficar *mais* rápido
e barato. Os hooks rodam em `SessionStart`/`Stop`, fora do caminho crítico de
cada resposta, e o hook de gravação (`Stop`) tem um teto rígido de ~8s antes
de cair no fallback 100% local — nunca trava o `/exit` esperando uma API
externa.
</details>

<details>
<summary><strong>O que acontece se eu não tiver Obsidian instalado?</strong></summary>

Os hooks tentam gravar mesmo assim (criam a pasta se não existir); só a
*leitura* confortável do resultado depende do app. `bin/doctor.mjs` avisa se
não encontrar o Obsidian instalado, sem travar o resto da instalação.
</details>

<details>
<summary><strong>Preciso pagar por alguma coisa?</strong></summary>

Não — `ai-memory` é open-source e roda localmente, Obsidian é gratuito pra
uso pessoal, e as skills companheiras listadas em
[`docs/skills-companion.md`](./docs/skills-companion.md) também são todas
gratuitas/open-source. O único custo é o da sua própria conta Claude
Code/Codex/Antigravity, que você já paga de qualquer forma.
</details>

<details>
<summary><strong>Preciso trocar o nome pra <code>muri-saver</code> funcionar?</strong></summary>

Não, é opcional. Sem `--alias`, o nome padrão continua sendo `muri-saver` —
a personalização existe pra quem quer adotar o próprio nome (ver
[Personalize com o seu nome](#personalize-com-o-seu-nome---alias)), não é um
requisito de funcionamento.
</details>

<br>

## Documentação complementar

| | Documento | Conteúdo |
|---|---|---|
| 🧭 | [`docs/architecture.md`](./docs/architecture.md) | Por que cada peça existe, como se encaixam |
| 🧠 | [`docs/ai-memory-obsidian-setup.md`](./docs/ai-memory-obsidian-setup.md) | Instalação detalhada do `ai-memory` + Obsidian + MCP session-aware |
| 🧩 | [`docs/skills-companion.md`](./docs/skills-companion.md) | Skills de terceiros que uso, com créditos, vantagens e comando de instalação |
| 📥 | [`docs/session-ingestor.md`](./docs/session-ingestor.md) | Como `bin/ingest-sessions.mjs` importa sessões antigas de cada agente, sem LLM |
| 👤 | [`INSTALL.md`](./INSTALL.md) | Guia de instalação passo a passo pra humano |
| 🤖 | [`INSTALL-AI.md`](./INSTALL-AI.md) | Runbook pra uma IA instalar tudo sozinha, com onboarding `/grill-me` e verificação |

<br>

## Autoria e créditos

Feito e mantido por mim, [@murilolol](https://github.com/murilolol), a partir
do meu uso diário real de Claude Code. `muri-saver` e `grill-me` (a versão
vendorizada aqui) são conteúdo original. As demais skills citadas pertencem
aos seus respectivos autores — ver
[`docs/skills-companion.md`](./docs/skills-companion.md) pra crédito
individual de cada uma.

<br>

## Licença

MIT — ver [`LICENSE`](./LICENSE) pro conteúdo original deste repositório
(`muri-saver`, `grill-me`, hooks, scripts, documentação). Use, adapte,
quebre, mande PR se achar bug ou tiver uma regra melhor pra propor.

<br>

<p align="center">
  <sub>Se isso te economizou tokens ou uma tarde de sessão perdida, uma ⭐ no repositório ajuda outra pessoa a achar.</sub>
  <br />
  <a href="#muri-saver">⬆ Voltar ao topo</a>
</p>
