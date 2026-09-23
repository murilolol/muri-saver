# INSTALL-AI.md — runbook autônomo para a IA que for instalar isto

> Este arquivo existe pra uma única finalidade: alguém manda o link deste
> repositório pro **próprio agente de IA** (Claude Code, Codex, Antigravity,
> Cursor, o que for) e diz "instala isso pra mim". Você (a IA lendo isto
> agora) deve seguir os passos abaixo **em ordem, executando os comandos
> diretamente**, detectando sozinha o sistema operacional, e só parando para
> perguntar ao usuário nos pontos marcados com ⚠️. Não peça confirmação a
> cada comando — peça só nas decisões que só o usuário pode tomar.

## 0. Detectar o ambiente (primeiro comando, sempre)

```bash
node -e "console.log(process.platform, process.arch, require('os').homedir())"
```

Isso te dá os três fatos que decidem todo o resto: `darwin` (macOS), `linux`
ou `win32` (Windows), e o caminho da home. **Todo o resto deste guia usa
caminhos relativos à home** (`~/.claude`, `~/.agents/skills`, etc.) — eles
funcionam nos três sistemas porque `bin/install.mjs` e `bin/doctor.mjs` resolvem isso
sozinhos via `os.homedir()`/`path.join()`, nunca com `/` ou `\` hardcoded.
Você não precisa adaptar comandos manualmente por SO, exceto onde este
documento diz explicitamente o contrário (ex: onde o Obsidian instala o app).

Depois, confirme os pré-requisitos:

```bash
node --version    # precisa ser >= 18
python3 --version # ou "python --version" no Windows, se "python3" não existir
claude --version  # Claude Code CLI
```

⚠️ **Se Node ou Python não existirem**: pare e avise o usuário — não tente
instalar runtimes de sistema sozinha sem confirmação explícita. Se
`python3` não existir mas `python` existir (comum no Windows), siga em
frente mas note isso pro usuário — o `statusLine` do `settings.json` chama
especificamente `python3`.

## 1. Clonar e rodar o instalador

```bash
git clone https://github.com/murilolol/muri-saver.git
cd muri-saver
node bin/install.mjs --dry-run
```

Leia a saída do `--dry-run` (lista cada arquivo que seria copiado/mesclado —
nada é escrito ainda). Depois rode de verdade:

```bash
node bin/install.mjs
```

Isso, sozinho:
- copia `skills/muri-saver/SKILL.md` e `skills/grill-me/SKILL.md` →
  `~/.agents/skills/<nome>/SKILL.md`
- copia `hooks/*.mjs` → `~/.claude/hooks/`
- copia `scripts/*` → `~/.claude/scripts/` (com permissão de execução)
- mescla os hooks `Stop`/`SessionStart` + `statusLine` em
  `~/.claude/settings.json` (faz backup do arquivo original primeiro)
- cria `~/.claude/CLAUDE.md` a partir do template **só se ainda não existir**

Flags relevantes (combine como precisar):
- `--vault "<caminho-do-vault>"` — também cria o esqueleto de pastas do
  Obsidian (`dailies/`, `claude/sessions/`, `overview/`, `projects/`).
- `--with-codex` — o Codex já é detectado sozinho se `~/.codex` existir; use
  esta flag só se quiser forçar mesmo sem detecção.
- `--with-companion-skills` — também instala via `npx skills add` as skills
  de terceiros que valem a pena ter (`find-skills`, `tdd`, `prototype`,
  `grill-with-docs`). Ver [`docs/skills-companion.md`](./docs/skills-companion.md)
  pras outras (`openspec`, `graphify`, `impeccable`, `emil-design-eng`,
  `taste-skill`) que não têm instalação automática confiável.
- `--skip-claude-md` — pula a criação do `CLAUDE.md`.

⚠️ **Se `~/.claude/CLAUDE.md` já existir**: o instalador avisa e não
sobrescreve (você vai ver o AVISO na saída). Pergunte ao usuário se ele quer
que você faça o merge seção por seção com
[`claude-config/CLAUDE.md.template`](./claude-config/CLAUDE.md.template), ou
se prefere manter o dele como está.

## 2. `ai-memory` (memória persistente)

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

## 3. MCP servers (`ai-memory` + Obsidian)

Abra [`mcp/mcp-servers.example.json`](./mcp/mcp-servers.example.json). Troque
`<CAMINHO_DO_SEU_VAULT>` pelo caminho absoluto real do vault Obsidian do
usuário (pergunte se não tiver certeza ⚠️). Depois:

1. Leia `~/.claude.json` inteiro.
2. Localize (ou crie) a chave `mcpServers`.
3. Adicione as entradas `ai-memory` e `obsidian` do exemplo **sem tocar em
   nenhuma outra entrada existente**.
4. Escreva o arquivo de volta.

⚠️ **Se `~/.claude.json` já tiver outros MCP servers com credenciais (API
keys, tokens em `env`)**: nunca as edite, nunca as imprima no chat, nunca as
copie pra nenhum arquivo deste repositório ou de qualquer lugar.

## 4. Plugin `claude-obsidian` (opcional, mas recomendado)

Dá os comandos `/wiki`, `/save`, canvas, etc. dentro do Claude Code. Se
`bin/doctor.mjs` (passo 6) reportar que ele não está habilitado:

```
/plugin marketplace add AgriciDaniel/claude-obsidian
/plugin install claude-obsidian@agricidaniel-claude-obsidian
```

(Nomes exatos podem variar por versão do Claude Code — se o comando falhar,
use `/plugin` sem argumento pra abrir o menu interativo e procure por
"claude-obsidian".)

## 5. App Obsidian

Se `bin/doctor.mjs` reportar que o app não foi encontrado, baixe em
<https://obsidian.md> — instalador nativo pra macOS/Windows/Linux. Depois de
instalado, abra o app pelo menos uma vez e aponte pro vault que você criou no
Passo 1 (`--vault`) ou pro vault existente do usuário.

## 6. Verificação automática

```bash
node bin/doctor.mjs --vault "<caminho-do-vault>"
```

Isso substitui checar item por item manualmente — o script já detecta o SO e
reporta `OK` / `AVISO` / `FALHA` para: Node, Python, Claude Code CLI, binário
e servidor do `ai-memory`, hooks registrados em `settings.json`, plugin
`claude-obsidian`, MCP servers em `~/.claude.json`, app Obsidian instalado, e
a estrutura de pastas do vault. Trate cada `FALHA` como bloqueante e cada
`AVISO` como algo a mencionar pro usuário mas não necessariamente resolver
sozinha.

Se `bin/doctor.mjs` reportar `FALHA` em algo, volte pra seção correspondente
deste documento antes de seguir em frente.

## 7. Skills companheiras (opcional)

Se você rodou `bin/install.mjs --with-companion-skills` no Passo 1,
`find-skills`, `tdd`, `prototype` e `grill-with-docs` já foram instaladas.

⚠️ **Não confunda `grill-me` com `grill-with-docs`**: `grill-me` já foi
copiada no Passo 1 (é vendorizada, sempre acontece, nenhuma flag necessária)
— é o padrão do dia a dia. `grill-with-docs` é o upgrade opcional daqui
(passo 7), só pra quando a entrevista precisa virar ADR/glossário
permanente. As duas ficam instaladas ao mesmo tempo, uma não substitui a
outra — comparação completa em
[`docs/skills-companion.md`](./docs/skills-companion.md#grill-me-vs-grill-with-docs--uso-as-duas-pra-situações-diferentes).

Cada skill (instalada ou não) tem uma página própria em
[`skills/companion/<nome>/README.md`](./skills/companion/) — com o que ela
faz, o autor, quando usar e o comando de instalação. Se o usuário perguntar
sobre alguma delas, leia a página correspondente antes de responder, em vez
de inventar a descrição. Índice geral em
[`docs/skills-companion.md`](./docs/skills-companion.md) — são todas de
terceiros, mantidas fora deste repositório de propósito (nunca vendorize o
conteúdo delas aqui).

## 8. Reiniciar e confirmar

Peça pro usuário reiniciar o Claude Code (`/exit` e abrir de novo) pra
carregar `CLAUDE.md`, as skills e os hooks novos. Depois, confirme com ele:

1. Digitar `muri saver` numa conversa nova — o agente deve confirmar a
   ativação do modo.
2. Terminar essa sessão de teste e checar se apareceu uma entrada nova em
   `<vault>/dailies/Daily-YYYY-MM-DD.md` e em `<vault>/claude/sessions/`.

Se os dois funcionarem, a instalação está completa. Rode
`node bin/doctor.mjs` de novo a qualquer momento pra confirmar o estado geral —
ele é 100% leitura, seguro de rodar quantas vezes quiser.
