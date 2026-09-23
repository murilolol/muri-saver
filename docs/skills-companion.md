# Skills companheiras

Este repositório vendoriza (copia o arquivo inteiro) só as duas skills que são
realmente minhas: [`muri-saver`](../skills/muri-saver/SKILL.md) e
[`grill-me`](../skills/grill-me/SKILL.md). As outras skills que uso todo dia
— e que também valem a pena instalar pra ter a mesma experiência — **não
estão copiadas aqui**. São projetos de terceiros, mantidos nos repositórios
originais dos seus autores. Copiar o conteúdo delas pra cá seria desonesto
com quem escreveu, e pior pra você: a cópia fica desatualizada no dia
seguinte a um `git clone`, enquanto o comando de instalação abaixo sempre
puxa a versão mais recente direto da fonte.

O que este documento faz em vez disso: explica **o que cada skill resolve**,
**por que vale a pena instalar**, e **o comando exato** pra instalar direto
do autor original. Sirva-se do que fizer sentido pro seu fluxo — nenhuma
delas é obrigatória pro núcleo do muri-saver (`CLAUDE.md` + hooks + `ai-memory`
+ Obsidian) funcionar.

Todas rodam via [`npx skills`](https://skills.sh) (mantido pela Vercel), o
gerenciador de pacotes do ecossistema aberto de skills — instalar a primeira
da lista (`find-skills`) já te dá a ferramenta pra descobrir e instalar
qualquer skill nova que você precisar no futuro, sem precisar deste
documento.

---

## `find-skills`

**O que é:** o "gerenciador de pacotes" do ecossistema de skills — descobre,
instala e atualiza skills publicadas por qualquer pessoa, direto do GitHub.

**Vantagem de ter instalada:** sem ela, adicionar uma skill nova significa
pesquisar manualmente, achar o repositório certo e copiar arquivo por
arquivo. Com ela, a própria IA resolve "preciso de uma skill que faça X" e
instala sozinha via `npx skills add`.

**Quando eu uso:** toda vez que sinto falta de uma capacidade específica e
suspeito que já existe uma skill pronta pra ela, antes de escrever algo do
zero.

- Fonte: [vercel-labs/skills](https://github.com/vercel-labs/skills) (Vercel Labs) — MIT
- Instalar: `npx skills add vercel-labs/skills@find-skills`

---

## `tdd`

**O que é:** referência de test-driven development — o loop red→green, o que
faz um teste ser bom (não só "passar"), onde os testes devem morar, e os
anti-padrões mais comuns.

**Vantagem de ter instalada:** em vez de reexplicar "escreve o teste antes"
toda vez, a skill já carrega o vocabulário certo (o que é um teste que vale a
pena manter vs. um teste frágil) e aplica isso consistentemente entre
projetos diferentes.

**Quando eu uso:** implementando qualquer feature ou bugfix onde vale a pena
travar o comportamento com teste antes de mexer no código.

- Fonte: [mattpocock/skills](https://github.com/mattpocock/skills) (Matt Pocock) — MIT
- Instalar: `npx skills add mattpocock/skills@tdd`

---

## `prototype`

**O que é:** protocolo pra construir um protótipo **descartável** que
responde uma pergunta específica de design — "esse modelo de estado faz
sentido?", "esse layout funciona?" — sem se preocupar em produzir código de
produção.

**Vantagem de ter instalada:** evita o extremo de "já parte pra implementação
final" quando a pergunta real ainda é incerta, e evita o outro extremo de
gastar tempo demais polindo um protótipo que vai ser jogado fora mesmo.

**Quando eu uso:** dúvida real sobre se uma lógica/estado ou uma tela "vai
funcionar" antes de comprometer a implementação de verdade.

- Fonte: [mattpocock/skills](https://github.com/mattpocock/skills) (Matt Pocock) — MIT
- Instalar: `npx skills add mattpocock/skills@prototype`

---

## `grill-me` — atenção, ver nota abaixo

**O que é no ecossistema:** uma entrevista estruturada pra alinhar requisitos
e arquitetura antes de implementar, evitando decisão tomada às pressas.

**A versão que eu uso é diferente da original** — ver a seção
[Sobre `grill-me` especificamente](#sobre-grill-me-especificamente) mais
abaixo. Por isso, ao contrário das outras desta lista, **ela está
vendorizada** em [`skills/grill-me/SKILL.md`](../skills/grill-me/SKILL.md)
neste repositório — não precisa instalar de fonte externa.

---

## `grill-with-docs`

**O que é:** a mesma ideia do `grill-me`, mas com um efeito colateral: a
entrevista também gera documentação permanente (ADR — decisão de arquitetura
registrada — e glossário de domínio) enquanto acontece.

**Vantagem de ter instalada:** quando a decisão que está sendo discutida é
grande o suficiente pra merecer registro formal (não só alinhar e seguir em
frente), essa versão evita ter que escrever o ADR manualmente depois.

**Quando eu uso:** ponto de corte natural num projeto grande — feature
fechada, decisão de arquitetura importante tomada — onde vale a pena deixar
rastro escrito, não só a conversa.

- Fonte: [mattpocock/skills](https://github.com/mattpocock/skills) (Matt Pocock) — MIT
- Instalar: `npx skills add mattpocock/skills@grill-with-docs`

---

## `openspec`

**O que é:** framework de especificação estruturada — requisitos,
arquitetura, contratos de dados, plano de execução em etapas verificáveis —
antes de escrever a implementação.

**Vantagem de ter instalada:** projetos que começam direto no código, sem
especificação, tendem a acumular decisão implícita que ninguém documentou.
`openspec` força a especificação a existir como artefato, não só como
intenção na cabeça de quem está codando.

**Quando eu uso:** começando um projeto novo do zero, ou formalizando uma
mudança grande demais pra confiar só na memória de curto prazo da conversa.

- Fonte: [openspecio/openspec](https://github.com/openspecio/openspec) — MIT
- Instalar: ver instruções de instalação no próprio repositório do projeto (o
  pacote no registro `npm` se chama `openspec`)

---

## `graphify`

**O que é:** transforma qualquer pasta — código, docs, esquemas de banco,
PDFs — num grafo de conhecimento navegável: comunidades de arquivos
relacionados, "god nodes" (arquivos com muitas dependências), e comandos
(`graphify query`, `graphify path`, `graphify explain`) pra navegar sem
precisar ler o repositório inteiro.

**Vantagem de ter instalada:** em repositórios grandes, perguntas tipo "como
esse módulo se conecta com aquele outro" ou "onde está o núcleo real desse
sistema" ficam muito mais baratas — o grafo já foi extraído uma vez
(localmente, via AST, sem custo de LLM) e as consultas seguintes reusam ele.

**Quando eu uso:** qualquer pergunta sobre arquitetura, relação entre
arquivos, ou "como esse código se conecta" — antes de sair grepando às
cegas.

- Fonte: [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) (autor: safishamsi) — Apache-2.0
- Instalar: ver instruções em [github.com/Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify)
- Se o projeto te ajudar, o autor pede apoio via [GitHub Sponsors](https://github.com/sponsors/safishamsi)

---

## `impeccable`

**O que é:** transforma a IA num "diretor de design sênior" pra revisar,
criticar e polir interface — hierarquia visual, acessibilidade, tipografia,
espaçamento, estados de erro, tema claro/escuro — em vez de aceitar o
primeiro resultado genérico.

**Vantagem de ter instalada:** sem uma skill dedicada, pedir "melhora o
design disso" tende a produzir mudança superficial (cor, sombra). Com ela, a
revisão cobre sistematicamente o que costuma ficar de fora: contraste,
comportamento responsivo, micro-interação, copy de erro.

**Quando eu uso:** qualquer tarefa de design/redesign de interface — desde
uma landing page até um dashboard — onde "funciona" não é o suficiente e
"parece pensado" importa.

- Fonte: [pbakaus/impeccable](https://github.com/pbakaus/impeccable) (Paul Bakaus) — Apache-2.0, site: [impeccable.style](https://impeccable.style)
- Instalar: `npx impeccable init`

---

## `superpowers` (pacote)

**O que é:** uma metodologia inteira de "pensar como dev sênior" — debugging
sistemático (achar causa raiz antes de tentar consertar), planejamento
estruturado, uso de git worktrees, protocolo de code review, TDD — como um
conjunto de skills que se complementam, não uma peça isolada.

**Vantagem de ter instalada:** cobre exatamente os pontos onde um agente
tende a "chutar" solução sem investigar (debugging) ou pular etapas de
planejamento — sem precisar escrever essas regras você mesmo, projeto por
projeto.

**Quando eu uso:** decisão técnica com trade-off real, debugging difícil
multi-camada, ou qualquer momento onde "só tentar de novo" já não está
funcionando.

- Fonte: [obra/superpowers](https://github.com/obra/superpowers) — MIT
- Instalar: `npx skills add obra/superpowers` (traz junto `test-driven-development`,
  `systematic-debugging`, `writing-plans`, `using-git-worktrees` e as demais
  skills do pacote)

---

## Sobre `grill-me` especificamente

O `grill-me` original do ecossistema (`mattpocock/skills@grill-me`) é hoje só
um redirecionamento de 5 linhas pra outra skill interna
(`Call the Skill tool with "grilling"`). A versão que uso e que está
vendorizada em [`skills/grill-me/SKILL.md`](../skills/grill-me/SKILL.md) é uma
reescrita completa e independente, feita por mim, especificamente pra forçar
o uso do modal nativo de perguntas (`AskUserQuestion` no Claude Code,
`ask_question` no Antigravity) em vez de texto cru no chat — é essa versão
que o `CLAUDE.md.template` e a skill `muri-saver` esperam encontrar. Por não
ser uma cópia de conteúdo alheio (o original tem 5 linhas genéricas; o meu é
uma reescrita própria sob o mesmo nome/conceito), ela é distribuída aqui sob
a licença MIT deste repositório, não a do projeto original.

## Tabela resumo

| Skill | Autor / fonte | Licença | Instalar |
|---|---|---|---|
| `find-skills` | [vercel-labs/skills](https://github.com/vercel-labs/skills) | MIT | `npx skills add vercel-labs/skills@find-skills` |
| `tdd` | [mattpocock/skills](https://github.com/mattpocock/skills) | MIT | `npx skills add mattpocock/skills@tdd` |
| `prototype` | [mattpocock/skills](https://github.com/mattpocock/skills) | MIT | `npx skills add mattpocock/skills@prototype` |
| `grill-me` | reescrita própria (ver nota acima) | MIT (deste repo) | já vendorizada em `skills/grill-me/` |
| `grill-with-docs` | [mattpocock/skills](https://github.com/mattpocock/skills) | MIT | `npx skills add mattpocock/skills@grill-with-docs` |
| `openspec` | [openspecio/openspec](https://github.com/openspecio/openspec) | MIT | ver repositório oficial |
| `graphify` | [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) | Apache-2.0 | ver repositório oficial |
| `impeccable` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | Apache-2.0 | `npx impeccable init` |
| `superpowers` (pack) | [obra/superpowers](https://github.com/obra/superpowers) | MIT | `npx skills add obra/superpowers` |

## Se um `npx skills add` falhar

O comando `@<nome>` às vezes precisa do caminho completo dentro do repositório
de origem em vez do nome curto (ex: `mattpocock/skills` organiza tudo em
`skills/engineering/...` e `skills/productivity/...`). Se o comando da tabela
não resolver, peça pra sua IA rodar:

```bash
npx skills find <nome-da-skill> --owner <owner-do-repo>
```

e escolher o pacote certo na lista interativa.
