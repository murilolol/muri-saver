# 🎞️ `emil-design-eng` (pacote `emilkowalski/skills`)

<p>
  <img src="https://img.shields.io/badge/tipo-skill_companheira-555?style=flat-square" alt="Skill companheira" />
  <img src="https://img.shields.io/badge/autor-Emil_Kowalski-000000?style=flat-square" alt="Autor: Emil Kowalski" />
  <img src="https://img.shields.io/badge/licença-MIT-yellow?style=flat-square" alt="Licença MIT" />
  <img src="https://img.shields.io/badge/status-planejado-orange?style=flat-square" alt="Status: planejado, ainda não uso" />
</p>

> [!NOTE]
> Esta pasta **não contém o código da skill** — é só documentação de apoio.
> Ver [`docs/skills-companion.md`](../../../docs/skills-companion.md) pra
> entender por quê.
>
> **Status no meu setup:** ainda não uso — planejo instalar.

Pacote de skills de design engineering feito por
[Emil Kowalski](https://github.com/emilkowalski) (autor do Vaul, Sonner, e
do curso [animations.dev](https://animations.dev)) — cobre revisão de
animação, vocabulário de movimento, princípios de restraint "estilo Apple",
escolha de biblioteca de UI e protótipos rápidos. A skill principal
(`emil-design-eng`) revisa código de UI com tabelas de antes/depois,
detecta erros comuns de animação (curva de easing errada, animar ações de
alta frequência) e aplica o framework do próprio Emil pra decidir o que
deveria animar e a que velocidade. O pacote também inclui `animate`
(constrói uma animação do zero), `review-animations` e `improve-animations`
(audita animações existentes e devolve plano de correção).

| | |
|---|---|
| **Autor** | [Emil Kowalski](https://github.com/emilkowalski/skills) |
| **Licença** | MIT |
| **Quando usar** | qualquer interface onde a motion importa — micro-interação, transição de estado, feedback visual — e "funciona mas parece genérico" não é o suficiente |
| **Vantagem de ter instalada** | em vez de aceitar a primeira animação que o modelo produz (geralmente `ease-in-out` genérico em tudo), a skill aplica critério real de quando/como animar, vindo de quem construiu bibliotecas de animação usadas em produção por milhares de projetos |

## Instalar

```bash
npx skills add emilkowalski/skills
```

---

[← Voltar pro índice de skills companheiras](../../../docs/skills-companion.md)
