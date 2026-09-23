---
name: grill-me
description: Protocolo de entrevista interativa nativa para alinhar requisitos e arquitetura via modal interativo de perguntas.
---

# /grill-me — Protocolo de Entrevista Interativa Nativa

Entreviste o usuário de forma profunda sobre cada aspecto da tarefa, arquitetura, design e regras de negócio usando a interface interativa nativa.

## Diretrizes Obrigatórias:
1. **NUNCA emitir perguntas em Markdown cru ou texto feio com emojis (ex: `❓ Q1`, `➡️ Recomendação`)**.
2. **Uso Obrigatório de Ferramenta Nativa de Modal/Interface**:
   - No **Antigravity (Google AGY / Gemini)**: Use a tool nativa `ask_question`.
   - No **Claude Code**: Use a tool nativa `AskUserQuestion`.
3. **Bateria Abrangente de 5 a 10+ Perguntas Contextuais**:
   - Não faça apenas 1 ou 2 perguntas rasas. Formule um questionário completo com **5 a 10 (ou mais)** perguntas cobrindo todos os eixos.
4. **Formatação das Opções**:
   - Cada pergunta deve ter opções claras formatadas como resposta direta do usuário.
   - A opção recomendada pelo agente deve ser colocada em primeiro lugar e prefixada com `(Recommended)`.
   - Utilize `is_multi_select: true` para perguntas onde o usuário pode combinar múltiplos recursos e `is_multi_select: false` para escolhas exclusivas.
5. **Finalização**:
   - Prossiga para o planejamento ou execução somente após o usuário responder às perguntas no modal interativo.
