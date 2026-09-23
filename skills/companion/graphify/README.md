# `graphify`

> Esta pasta **não contém o código da skill** — é só documentação de apoio.
> Ver [`docs/skills-companion.md`](../../../docs/skills-companion.md) pra
> entender por quê.

**O que é:** transforma qualquer pasta — código, docs, esquemas de banco,
PDFs — num grafo de conhecimento navegável: comunidades de arquivos
relacionados, "god nodes" (arquivos com muitas dependências), e comandos
(`graphify query`, `graphify path`, `graphify explain`) pra navegar sem
precisar ler o repositório inteiro.

**Autor:** safishamsi — [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify)
**Licença:** Apache-2.0

**Quando usar:** qualquer pergunta sobre arquitetura, relação entre
arquivos, ou "como esse código se conecta" — antes de sair grepando às
cegas.

**Vantagem de ter instalada:** em repositórios grandes, perguntas tipo "como
esse módulo se conecta com aquele outro" ou "onde está o núcleo real desse
sistema" ficam muito mais baratas — o grafo já foi extraído uma vez
(localmente, via AST, sem custo de LLM) e as consultas seguintes reusam ele.

## Instalar

Ver instruções em [github.com/Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify).
Se o projeto te ajudar, o autor pede apoio via
[GitHub Sponsors](https://github.com/sponsors/safishamsi).
