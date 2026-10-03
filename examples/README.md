# Exemplos

Comece pelo [fluxo fictício completo](./flow.md): instalação, sessão,
handoff e importação em um projeto de demonstração.

[`vault/`](./vault/) é a saída **real** do muri-saver — nada aqui foi escrito
à mão. Foi gerada por [`tools/build-assets.mjs`](../tools/build-assets.mjs) a
partir das sessões fictícias em [`test/fixtures/`](../test/fixtures/) (um
projeto de demonstração, `demo-app`, com uma chave de API falsa de propósito
pra mostrar o mascaramento).

| Arquivo | Gerado por | O que mostra |
|---|---|---|
| [`claude/sessions/…-Claude-3a3a3a3a.md`](./vault/claude/sessions/) | Nota viva v2: hook `Stop` + worker da narrativa (com o `agy` falso de `tools/test-bin/`) | Bloco `auto-narrativa` (síntese, decisões, ações, erros, arquivos) e bloco `auto-dump` lado a lado, mais o `.canvas` da sessão |
| [`claude/sessions/…-Claude-b7e4c2a1.md`](./vault/claude/sessions/) | Hook `Stop` ao vivo, sem narrativa | Nota v2 só com o dump local (instantâneo, sem LLM), com a chave falsa como `[REDACTED:ANTHROPIC_KEY]` |
| [`claude/sessions/…-Claude-0f1e2d3c.md`](./vault/claude/sessions/) | `ingest-sessions.mjs --enrich` | Narrativa gerada por uma chamada real ao Haiku + transcrição sanitizada |
| [`projects/demo-app/`](./vault/projects/demo-app/) | `ingest-sessions.mjs --enrich` | Notas atômicas de bug, correção e decisão, e a contagem no `README.md` do projeto |
| [`antigravity/sessions/`](./vault/antigravity/sessions/) | `ingest-sessions.mjs` | Import sem LLM; tags `<USER_REQUEST>`/`<ADDITIONAL_METADATA>` removidas |
| [`codex/sessions/`](./vault/codex/sessions/) · [`codex/dailies/`](./vault/codex/dailies/) | `ingest-sessions.mjs` | Projeto detectado a partir de um `cwd` Windows (`C:\Users\...\api-server`), token do GitHub mascarado |
| [`desktop/sessions/`](./vault/desktop/sessions/) | `ingest-sessions.mjs --file conversations.json` | Export do Claude Desktop/Web |
| [`dailies/`](./vault/dailies/) | Hook + ingestor | Diário de bordo cross-agente, com cada sessão dentro de "Sessões do Dia" |

Pra regenerar: `npm run assets`. Sem `--with-llm` o build não chama nenhum
modelo de verdade (a nota viva usa o `agy` falso) e a nota enriquecida pelo
ingestor sai sem narrativa: restaure-a do git ou use `--with-llm`. Só os
prints: `node tools/build-assets.mjs --only-screenshots`. O GitHub renderiza os `.md` direto, mas
wikilinks (`[[...]]`) só viram links de verdade abertos no Obsidian — abra a
pasta `vault/` como um vault pra ver o grafo.
