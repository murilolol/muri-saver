---
title: "Botão de login quebra em viewports mobile"
projeto: demo-app
categoria: bug
origem: usuario
status: feito
prioridade: alta
origem_sessao: "[[claude/sessions/Session-2026-09-20_10h00-Claude-0f1e2d3c]]"
date: 2026-09-20
generated: ingest-sessions-enriched
tags:
  - bug
  - demo-app
---

# 🐛 Botão de login quebra em viewports mobile

🏷️ **Tags:** #bug #demo-app

- **Projeto:** [[projects/demo-app/README|demo-app]]
- **Status:** feito · **Prioridade:** alta
- **Origem:** usuario
- **Sessão de origem:** [[claude/sessions/Session-2026-09-20_10h00-Claude-0f1e2d3c|Sessão Claude 0f1e2d3c]]
- **Data:** 2026-09-20

Componente Login.tsx usava largura fixa de 420px, quebrando em telas menores (375px). Corrigido com max-width responsivo.
