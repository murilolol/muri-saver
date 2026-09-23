# `grill-with-docs`

> Esta pasta **não contém o código da skill** — é só documentação de apoio.
> Ver [`docs/skills-companion.md`](../../../docs/skills-companion.md) pra
> entender por quê.

> **Uso esta skill junto com [`skills/grill-me/`](../../grill-me/), não no
> lugar dela** — são complementares, não alternativas. Comparação completa
> em [`docs/skills-companion.md#grill-me-vs-grill-with-docs--uso-as-duas-pra-situações-diferentes`](../../../docs/skills-companion.md#grill-me-vs-grill-with-docs--uso-as-duas-pra-situações-diferentes).

**O que é:** a mesma ideia do `grill-me` (entrevista estruturada pra alinhar
requisitos e arquitetura via modal nativo), mas com um efeito colateral: a
entrevista também gera documentação permanente — ADR (decisão de
arquitetura registrada) e glossário de domínio — enquanto acontece.

**Autor:** [Matt Pocock](https://github.com/mattpocock/skills)
**Licença:** MIT

**Quando usar:** ponto de corte natural num projeto grande — feature
fechada, decisão de arquitetura importante tomada — onde vale a pena deixar
rastro escrito, não só a conversa.

**Vantagem de ter instalada:** quando a decisão discutida é grande o
suficiente pra merecer registro formal (não só alinhar e seguir em frente),
essa versão evita ter que escrever o ADR manualmente depois.

## Instalar

```bash
npx skills add mattpocock/skills@grill-with-docs
```
