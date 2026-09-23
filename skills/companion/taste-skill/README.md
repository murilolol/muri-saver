# 🖌️ `taste-skill`

<p>
  <img src="https://img.shields.io/badge/tipo-skill_companheira-555?style=flat-square" alt="Skill companheira" />
  <img src="https://img.shields.io/badge/autor-Leonxlnx-000000?style=flat-square" alt="Autor: Leonxlnx" />
  <img src="https://img.shields.io/badge/licença-MIT-yellow?style=flat-square" alt="Licença MIT" />
  <img src="https://img.shields.io/badge/status-planejado-orange?style=flat-square" alt="Status: planejado, ainda não uso" />
</p>

> [!NOTE]
> Esta pasta **não contém o código da skill** — é só documentação de apoio.
> Ver [`docs/skills-companion.md`](../../../docs/skills-companion.md) pra
> entender por quê.
>
> **Status no meu setup:** ainda não uso — planejo instalar.

Dá "bom gosto" pro agente de IA parar de gerar interface genérica ("slop") —
layout, tipografia, motion e espaçamento mais deliberados em vez de
boilerplate visual. O diferencial é trabalhar a partir dos pixels de uma
referência real: scripts extraem detalhes de design num formato
estruturado, em vez de resumir um visual em texto que o modelo depois tem
que reimaginar. O pacote também inclui skills de geração de imagem pra
montar mood boards (web, mobile, brand kit) que alimentam a implementação.

| | |
|---|---|
| **Autor** | [Leonxlnx](https://github.com/Leonxlnx/taste-skill) |
| **Licença** | MIT |
| **Quando usar** | landing pages, portfólios e redesigns onde a saída da IA tende a sair genérica e você quer algo com direção visual deliberada, não mais um template |
| **Vantagem de ter instalada** | em vez de descrever o design em texto (que se perde na reimaginação do modelo), a skill trabalha com a referência visual de verdade — reduz a distância entre "o que eu queria" e "o que saiu" |

> [!TIP]
> **Nota de nome:** o repositório se chama `taste-skill`, mas a skill
> instalável dentro dele hoje se chama `design-taste-frontend` (a v2,
> default atual); `design-taste-frontend-v1` fica disponível só pra quem
> depende do comportamento exato da v1.

## Instalar

```bash
npx skills add https://github.com/Leonxlnx/taste-skill --skill design-taste-frontend
```

---

[← Voltar pro índice de skills companheiras](../../../docs/skills-companion.md)
