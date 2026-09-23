# INSTALL-AI.md — runbook autônomo para a IA que for instalar isto

<p>
  <img src="https://img.shields.io/badge/audi%C3%AAncia-agente_de_IA-6E56CF?style=flat-square" alt="Audiência: agente de IA" />
  <img src="https://img.shields.io/badge/passos-11-blue?style=flat-square" alt="11 passos" />
  <img src="https://img.shields.io/badge/onboarding-%2Fgrill--me-D97757?style=flat-square" alt="Onboarding via /grill-me" />
</p>

> [!IMPORTANT]
> Este arquivo existe pra uma única finalidade: alguém manda o link deste
> repositório pro **próprio agente de IA** (Claude Code, Codex, Antigravity,
> Cursor, o que for) e diz "instala isso pra mim". Você (a IA lendo isto
> agora) deve seguir os passos abaixo **em ordem, executando os comandos
> diretamente**, detectando sozinha o sistema operacional, e só parando para
> perguntar ao usuário nos pontos marcados com ⚠️. Não peça confirmação a
> cada comando — peça só nas decisões que só o usuário pode tomar.

**Passos:** [0. Onboarding `/grill-me`](#0-onboarding-interativo-grill-me--sempre-o-primeiro-passo) ·
[1. Ambiente](#1-detectar-o-ambiente-primeiro-comando-técnico-sempre) ·
[2. Instalador](#2-clonar-e-rodar-o-instalador) ·
[3. ai-memory](#3-ai-memory-memória-persistente) ·
[4. MCP](#4-mcp-servers-ai-memory--obsidian) ·
[5. Plugin](#5-plugin-claude-obsidian-opcional-mas-recomendado) ·
[6. Obsidian](#6-app-obsidian) ·
[7. Doctor](#7-verificação-automática) ·
[8. Ingestor](#8-importar-sessões-antigas-bin-ingest-sessionsmjs--se-a-resposta-da-pergunta-3-foi-sim) ·
[9. Skills companheiras](#9-skills-companheiras-opcional) ·
[10. Confirmar](#10-reiniciar-e-confirmar)

## 0. Onboarding interativo (`/grill-me`) — sempre o primeiro passo

Antes de rodar qualquer comando, alinhe as decisões que só o usuário pode
tomar. **Não pergunte item por item em texto corrido** — dispare uma única
bateria de perguntas usando a ferramenta nativa de formulário/modal do seu
harness:

- No **Claude Code**: `AskUserQuestion`.
- No **Antigravity**: `ask_question`.
- Em qualquer outro harness sem tool nativa de formulário confirmada (ex:
  Codex CLI hoje): apresente a mesma lista como perguntas numeradas e claras
  no terminal, aguardando a resposta antes de seguir — nunca invente as
  respostas por conta própria.

Faça estas 5 perguntas (com as opções sugeridas entre parênteses; marque a
primeira opção como recomendada quando aplicável):

1. **Identidade da skill**: "Você quer manter o nome padrão `muri-saver` ou
   personalizar (ex: `mendes-saver`, `lucas-saver`, `dev-saver`, ou só um
   nome como `lucas`)?" — (Recomendado: manter `muri-saver` se for a
   primeira vez usando; personalizar se o usuário já se identificou pelo
   nome/apelido na conversa.)
2. **Agentes usados nesta máquina**: "Quais IAs de código você usa aqui?"
   (multi-seleção: Claude Code / Antigravity (Google AGY / Gemini CLI) /
   Codex CLI / mais de um).
3. **Ingestão retroativa**: "Quer que eu importe as sessões antigas dessas
   IAs (que já existem na sua máquina) pro Obsidian Vault e/ou pro
   `ai-memory` agora, ou só configurar a governança daqui pra frente?" —
   (Recomendado: importar, com `--dry-run` primeiro pra revisar antes.)
4. **Caminho do Obsidian Vault**: "Qual o caminho do seu vault?" (padrão
   sugerido: `~/Documents/Obsidian Vault` — pergunte se ele já tem um vault
   em outro lugar).
5. **Skills companheiras**: "Quer instalar também as skills companheiras
   recomendadas (`find-skills`, `tdd`, `prototype`, `grill-with-docs`)?" —
   (Recomendado: sim, elas ajudam com descoberta de skills, TDD e
   prototipagem — mas nenhuma é obrigatória pro muri-saver funcionar.)

Com as respostas em mãos, os passos abaixo já te dizem exatamente qual flag
usar pra cada resposta — não precisa adivinhar.

## 1. Detectar o ambiente (primeiro comando técnico, sempre)

```bash
node -e "console.log(process.platform, process.arch, require('os').homedir())"
```

Isso te dá os três fatos que decidem todo o resto: `darwin` (macOS), `linux`
ou `win32` (Windows), e o caminho da home. **Todo o resto deste guia usa
caminhos relativos à home** (`~/.claude`, `~/.agents/skills`, etc.) — eles
funcionam nos três sistemas porque `bin/install.mjs`, `bin/doctor.mjs` e
`bin/ingest-sessions.mjs` resolvem isso sozinhos via `os.homedir()`/`path.join()`,
nunca com `/` ou `\` hardcoded. Você não precisa adaptar comandos manualmente
por SO, exceto onde este documento diz explicitamente o contrário (ex: onde o
Obsidian instala o app).

Depois, confirme os pré-requisitos:

```bash
node --version    # precisa ser >= 18
python3 --version # ou "python --version" no Windows, se "python3" não existir
claude --version  # Claude Code CLI
```

> [!WARNING]
> **Se Node ou Python não existirem**: pare e avise o usuário — não tente
> instalar runtimes de sistema sozinha sem confirmação explícita. Se
> `python3` não existir mas `python` existir (comum no Windows), siga em
> frente mas note isso pro usuário — o `statusLine` do `settings.json` chama
> especificamente `python3`.

## 2. Clonar e rodar o instalador

```bash
git clone https://github.com/murilolol/muri-saver.git
cd muri-saver
node bin/install.mjs --dry-run
```

Leia a saída do `--dry-run` (lista cada arquivo que seria copiado/mesclado —
nada é escrito ainda). Depois rode de verdade, **traduzindo as respostas do
Passo 0 em flags**:

```bash
node bin/install.mjs \
  [--alias "<nome-da-pergunta-1>"] [--author-name "<nome-do-usuário>"] \
  [--with-antigravity] [--with-codex]   # conforme a pergunta 2 (pode combinar os dois, ou usar --with-all) \
  [--vault "<caminho-da-pergunta-4>"] \
  [--with-companion-skills]             # se a resposta da pergunta 5 foi sim
```

Isso, sozinho:
- copia `skills/muri-saver/SKILL.md` (com o alias aplicado, se algum foi
  pedido) e `skills/grill-me/SKILL.md` → `~/.agents/skills/<alias>/SKILL.md`
  e `~/.agents/skills/grill-me/SKILL.md`
- copia `hooks/*.mjs` → `~/.claude/hooks/`
- copia `scripts/*` → `~/.claude/scripts/` (com permissão de execução)
- mescla os hooks `Stop`/`SessionStart` + `statusLine` em
  `~/.claude/settings.json` (faz backup do arquivo original primeiro)
- cria `~/.claude/CLAUDE.md` a partir do template **só se ainda não existir**
- com `--with-antigravity`: cria `~/.gemini/GEMINI.md`, copia a skill pra
  `~/.gemini/config/skills/<alias>/`, mescla `~/.gemini/config/hooks.json`
- com `--with-codex`: cria `~/.codex/AGENTS.md`, copia o hook Codex, mescla
  `~/.codex/hooks.json`
- com `--with-all`: os dois acima de uma vez

Flags de diretório pra testes/instalações não-padrão (raramente necessárias):
`--claude-dir`, `--skills-dir`, `--codex-dir`, `--gemini-dir`.

> [!WARNING]
> **Se `~/.claude/CLAUDE.md` (ou `~/.gemini/GEMINI.md`/`~/.codex/AGENTS.md`)
> já existir**: o instalador avisa e não sobrescreve (você vai ver o AVISO na
> saída). Pergunte ao usuário se ele quer que você faça o merge seção por
> seção com o template correspondente em
> `claude-config/`/`antigravity-config/`/`codex-config/`, ou se prefere
> manter o dele como está.

## 3. `ai-memory` (memória persistente)

**O que é, antes de instalar:** [ai-memory](https://github.com/akitaonrails/ai-memory)
é um servidor de memória de longo prazo pra agentes de IA coding, criado por
[Fabio Akita](https://github.com/akitaonrails) (MIT, Rust, 8k+ estrelas). Ele
resolve o problema de cada agente/máquina ter sua própria memória isolada:
20+ harnesses (Claude Code, Codex, Cursor, Gemini CLI...) podem alimentar a
mesma memória compartilhada, guardada como wiki markdown versionada
(indexada em SQLite/FTS5), com captura automática via hooks e handoff real
entre sessões — sem exigir nenhuma chamada de LLM no caminho padrão. Se o
usuário perguntar "o que é isso", essa é a explicação; detalhes completos em
[`README.md#ai-memory`](./README.md#ai-memory).

Isto **não** é instalado pelo `bin/install.mjs` de propósito — é um projeto
externo com seu próprio instalador. Siga
**[`docs/ai-memory-obsidian-setup.md`](./docs/ai-memory-obsidian-setup.md)**
na íntegra. Resumo do que você vai fazer lá:

1. Instalar o binário `ai-memory` (<https://github.com/akitaonrails/ai-memory>).
2. `ai-memory install-hooks --client claude-code`
3. `ai-memory install-mcp --client claude-code --session-aware --apply`
4. Opcional: configurar um provedor de LLM pra consolidação rica (não
   heurística) — **preste atenção especial à nota sobre
   `ANTHROPIC_OAUTH_TOKEN` vs `CLAUDE_CODE_OAUTH_TOKEN`** no doc, setar a
   errada quebra o login do Claude Code inteiro.

## 4. MCP servers (`ai-memory` + Obsidian)

Abra [`mcp/mcp-servers.example.json`](./mcp/mcp-servers.example.json). Troque
`<CAMINHO_DO_SEU_VAULT>` pelo caminho absoluto real do vault Obsidian do
usuário (a resposta da pergunta 4 do Passo 0). Depois:

1. Leia `~/.claude.json` inteiro.
2. Localize (ou crie) a chave `mcpServers`.
3. Adicione as entradas `ai-memory` e `obsidian` do exemplo **sem tocar em
   nenhuma outra entrada existente**.
4. Escreva o arquivo de volta.

> [!CAUTION]
> **Se `~/.claude.json` já tiver outros MCP servers com credenciais (API
> keys, tokens em `env`)**: nunca as edite, nunca as imprima no chat, nunca
> as copie pra nenhum arquivo deste repositório ou de qualquer lugar.

## 5. Plugin `claude-obsidian` (opcional, mas recomendado)

Dá os comandos `/wiki`, `/save`, canvas, etc. dentro do Claude Code. Se
`bin/doctor.mjs` (passo 7) reportar que ele não está habilitado:

```
/plugin marketplace add AgriciDaniel/claude-obsidian
/plugin install claude-obsidian@agricidaniel-claude-obsidian
```

(Nomes exatos podem variar por versão do Claude Code — se o comando falhar,
use `/plugin` sem argumento pra abrir o menu interativo e procure por
"claude-obsidian".)

## 6. App Obsidian

Se `bin/doctor.mjs` reportar que o app não foi encontrado, baixe em
<https://obsidian.md> — instalador nativo pra macOS/Windows/Linux. Depois de
instalado, abra o app pelo menos uma vez e aponte pro vault que você criou no
Passo 2 (`--vault`) ou pro vault existente do usuário.

## 7. Verificação automática

```bash
node bin/doctor.mjs --vault "<caminho-do-vault>"
```

Isso substitui checar item por item manualmente — o script já detecta o SO e
reporta `OK` / `AVISO` / `FALHA` para: Node, Python, Claude Code CLI, binário
e servidor do `ai-memory`, hooks registrados em `settings.json`, plugin
`claude-obsidian`, MCP servers em `~/.claude.json`, app Obsidian instalado, a
estrutura de pastas do vault, o alias configurado (padrão ou customizado), as
sessões brutas + governança de cada agente (Claude Code/Antigravity/Codex), e
a presença do ingestor. Trate cada `FALHA` como bloqueante e cada `AVISO`
como algo a mencionar pro usuário mas não necessariamente resolver sozinha.

Se `bin/doctor.mjs` reportar `FALHA` em algo, volte pra seção correspondente
deste documento antes de seguir em frente.

## 8. Importar sessões antigas (`bin/ingest-sessions.mjs`) — se a resposta da pergunta 3 foi sim

```bash
node bin/ingest-sessions.mjs --all --dry-run
```

Revise a saída com o usuário (quantas sessões por agente, desde quando) antes
de rodar de verdade. Sugestões de flag conforme o volume:

```bash
# Importação completa
node bin/ingest-sessions.mjs --all

# Só as N sessões mais recentes por agente (bom pra primeira importação de teste)
node bin/ingest-sessions.mjs --all --limit 20

# Só a partir de uma data
node bin/ingest-sessions.mjs --all --since 2026-09-01
```

Isso nunca chama LLM nenhuma (extração 100% local — ver
[`docs/session-ingestor.md`](./docs/session-ingestor.md) pro porquê) e é
idempotente: rodar de novo não duplica nada já importado. Se o usuário tiver
um export do Claude Desktop/Web (`conversations.json`), use `--file
<caminho>` em vez de `--all`/`--agent`.

## 9. Skills companheiras (opcional)

Se você rodou `bin/install.mjs --with-companion-skills` no Passo 2,
`find-skills`, `tdd`, `prototype` e `grill-with-docs` já foram instaladas.

> [!NOTE]
> **Não confunda `grill-me` com `grill-with-docs`**: `grill-me` já foi
> copiada no Passo 2 (é vendorizada, sempre acontece, nenhuma flag
> necessária) — é o padrão do dia a dia (e é ela que você já está usando pro
> onboarding do Passo 0). `grill-with-docs` é o upgrade opcional daqui
> (passo 9), só pra quando a entrevista precisa virar ADR/glossário
> permanente. As duas ficam instaladas ao mesmo tempo, uma não substitui a
> outra — comparação completa em
> [`docs/skills-companion.md`](./docs/skills-companion.md#grill-me-vs-grill-with-docs--uso-as-duas-pra-situações-diferentes).

Cada skill (instalada ou não) tem uma página própria em
[`skills/companion/<nome>/README.md`](./skills/companion/) — com o que ela
faz, o autor, quando usar e o comando de instalação. Se o usuário perguntar
sobre alguma delas, leia a página correspondente antes de responder, em vez
de inventar a descrição. Índice geral em
[`docs/skills-companion.md`](./docs/skills-companion.md) — são todas de
terceiros, mantidas fora deste repositório de propósito (nunca vendorize o
conteúdo delas aqui).

## 10. Reiniciar e confirmar

Peça pro usuário reiniciar o Claude Code (`/exit` e abrir de novo — e
Antigravity/Codex, se instalados) pra carregar `CLAUDE.md`/`GEMINI.md`/`AGENTS.md`,
as skills e os hooks novos. Depois, confirme com ele:

1. Digitar o gatilho da skill (ex: `muri saver`, ou o alias escolhido no
   Passo 0) numa conversa nova — o agente deve confirmar a ativação do modo.
2. Terminar essa sessão de teste e checar se apareceu uma entrada nova em
   `<vault>/dailies/Daily-YYYY-MM-DD.md` e em `<vault>/claude/sessions/`
   (ou `<vault>/antigravity/sessions/`/`<vault>/codex/sessions/`, conforme o
   agente testado).

Se os dois funcionarem, a instalação está completa. Rode
`node bin/doctor.mjs` de novo a qualquer momento pra confirmar o estado geral —
ele é 100% leitura, seguro de rodar quantas vezes quiser.
