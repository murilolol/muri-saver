# Skills companheiras

<p>
  <img src="https://img.shields.io/badge/vendorizadas_aqui-2-brightgreen?style=flat-square" alt="2 skills vendorizadas" />
  <img src="https://img.shields.io/badge/companheiras_de_terceiros-9-blue?style=flat-square" alt="9 skills companheiras" />
  <img src="https://img.shields.io/badge/gerenciador-npx_skills-000?style=flat-square" alt="npx skills" />
</p>

Este repositório vendoriza (copia o arquivo inteiro) só as duas skills que são
realmente minhas: [`muri-saver`](../skills/muri-saver/SKILL.md) e
[`grill-me`](../skills/grill-me/SKILL.md). As outras skills que uso todo dia
— e que também valem a pena instalar pra ter a mesma experiência — **não
estão copiadas aqui**. São projetos de terceiros, mantidos nos repositórios
originais dos seus autores. Copiar o conteúdo delas pra cá seria desonesto
com quem escreveu, e pior pra você: a cópia fica desatualizada no dia
seguinte a um `git clone`, enquanto o comando de instalação sempre puxa a
versão mais recente direto da fonte.

Cada uma tem sua própria pasta em [`skills/companion/`](../skills/companion/)
— não com o código da skill, mas com um `README.md` curto explicando o que
ela é, quem fez, quando eu uso, a vantagem real de instalar, e o comando
exato pra instalar direto do autor original.

Todas rodam via [`npx skills`](https://skills.sh) (mantido pela Vercel), o
gerenciador de pacotes do ecossistema aberto de skills — instalar a primeira
da lista (`find-skills`) já te dá a ferramenta pra descobrir e instalar
qualquer skill nova que você precisar no futuro, sem precisar deste
documento.

<br>

## Índice

| | Skill | Status | Autor / fonte | Licença | Documentação |
|---|---|---|---|---|---|
| 🔍 | `find-skills` | ✅ uso hoje | [vercel-labs/skills](https://github.com/vercel-labs/skills) | MIT | [skills/companion/find-skills/](../skills/companion/find-skills/README.md) |
| 🧪 | `tdd` | ✅ uso hoje | [mattpocock/skills](https://github.com/mattpocock/skills) | MIT | [skills/companion/tdd/](../skills/companion/tdd/README.md) |
| 🧬 | `prototype` | ✅ uso hoje | [mattpocock/skills](https://github.com/mattpocock/skills) | MIT | [skills/companion/prototype/](../skills/companion/prototype/README.md) |
| ❓ | `grill-me` | ✅ uso hoje | reescrita própria (ver nota abaixo) | MIT (deste repo) | já vendorizada em [`skills/grill-me/`](../skills/grill-me/SKILL.md) |
| 📝 | `grill-with-docs` | ✅ uso hoje | [mattpocock/skills](https://github.com/mattpocock/skills) | MIT | [skills/companion/grill-with-docs/](../skills/companion/grill-with-docs/README.md) |
| 📐 | `openspec` | ✅ uso hoje | [openspecio/openspec](https://github.com/openspecio/openspec) | MIT | [skills/companion/openspec/](../skills/companion/openspec/README.md) |
| 🕸️ | `graphify` | ✅ uso hoje | [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) (safishamsi) | Apache-2.0 | [skills/companion/graphify/](../skills/companion/graphify/README.md) |
| 🎨 | `impeccable` | ✅ uso hoje | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | Apache-2.0 | [skills/companion/impeccable/](../skills/companion/impeccable/README.md) |
| 🎞️ | `emil-design-eng` (pack) | 🔜 quero usar | [emilkowalski/skills](https://github.com/emilkowalski/skills) | MIT | [skills/companion/emil-design-eng/](../skills/companion/emil-design-eng/README.md) |
| 🖌️ | `taste-skill` | 🔜 quero usar | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | MIT | [skills/companion/taste-skill/](../skills/companion/taste-skill/README.md) |

> [!NOTE]
> Não uso (e não recomendo por padrão) o pacote `obra/superpowers` — é ótimo,
> mas pesado: puxa muito contexto/token pro que meu fluxo precisa. Combina bem
> com a filosofia deste repositório (`muri-saver` existe justamente pra cortar
> gasto desnecessário) deixar ele de fora até que o custo compense.

<br>

## `grill-me` vs `grill-with-docs` — uso as duas, pra situações diferentes

Não é "uma substitui a outra" — no meu fluxo real elas resolvem problemas
diferentes e as duas ficam instaladas ao mesmo tempo:

| | `grill-me` | `grill-with-docs` |
|---|---|---|
| **Instalação neste repo** | Vendorizada — sempre copiada por `bin/install.mjs`, nenhuma flag necessária | Não vendorizada — de terceiros, instale com `npx skills add mattpocock/skills@grill-with-docs` (ou `--with-companion-skills`) |
| **O que faz** | Entrevista rápida via modal nativo (`AskUserQuestion`/`ask_question`) pra alinhar requisitos/arquitetura antes de agir | A mesma entrevista, só que também gera ADR + glossário como artefato permanente enquanto entrevista |
| **Quando eu uso** | Praticamente sempre que a skill `muri-saver` decide que vale a pena entrevistar — é o padrão | Só quando a decisão é grande o suficiente pra merecer registro formal (feature fechada, arquitetura importante) — a exceção, não a regra |
| **Custo** | Mais leve — sem gerar documento | Mais pesado — grava ADR/glossário junto |

Na prática: `grill-me` é o padrão do dia a dia (por isso é minha, vendorizada,
sempre presente); `grill-with-docs` é o upgrade opcional pra quando o
resultado da entrevista precisa virar documentação que sobrevive à
conversa. A própria [`skills/muri-saver/SKILL.md`](../skills/muri-saver/SKILL.md)
já decide qual oferecer em cada situação, na tabela "Orquestração de skills
favoritas".

### Por que `grill-me` é vendorizada e `grill-with-docs` não

O `grill-me` original do ecossistema (`mattpocock/skills@grill-me`) é hoje só
um redirecionamento de 5 linhas pra outra skill interna
(`Call the Skill tool with "grilling"`). A versão que uso e que está
vendorizada em [`skills/grill-me/SKILL.md`](../skills/grill-me/SKILL.md) é uma
reescrita completa e independente, feita por mim, especificamente pra forçar
o uso do modal nativo de perguntas em vez de texto cru no chat — é essa
versão que a governança global (`CLAUDE.md`/`GEMINI.md`/`AGENTS.md`) e a
skill `muri-saver` esperam encontrar. Por não ser uma cópia de conteúdo
alheio (o original tem 5 linhas genéricas; o meu é uma reescrita própria sob
o mesmo nome/conceito), ela é distribuída aqui sob a licença MIT deste
repositório, não a do projeto original.

`grill-with-docs`, por outro lado, está instalada e funcionando **sem
modificação** em relação ao `mattpocock/skills` original — não há reescrita
minha ali pra justificar vendorizar, então ela segue a mesma regra das
outras skills companheiras: documentação aqui, código na fonte oficial.

<br>

## Se um `npx skills add` falhar

O comando `@<nome>` às vezes precisa do caminho completo dentro do
repositório de origem em vez do nome curto (ex: `mattpocock/skills` organiza
tudo em `skills/engineering/...` e `skills/productivity/...`). Se o comando
de alguma página acima não resolver, peça pra sua IA rodar:

```bash
npx skills find <nome-da-skill> --owner <owner-do-repo>
```

e escolher o pacote certo na lista interativa.
