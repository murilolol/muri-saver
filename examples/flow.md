# Fluxo fictício completo

Este exemplo acompanha o projeto fictício `demo-app`. Os arquivos em
[`vault/`](./vault/) foram gerados a partir de fixtures de teste; o diálogo
abaixo ilustra como as peças se conectam, sem usar sessões pessoais.

## 1. Instalar e conferir

```bash
node bin/install.mjs --dry-run --with-all --vault "/caminho/para/vault"
node bin/install.mjs --with-all --vault "/caminho/para/vault"
ai-memory install-hooks --client claude-code
ai-memory install-mcp --client claude-code --session-aware --apply
node bin/doctor.mjs
```

O instalador prepara skills e hooks; o `ai-memory` é instalado à parte.
Quem não quiser Obsidian omite `--vault` e a integração opcional de
[`mcp/obsidian.optional.example.json`](../mcp/obsidian.optional.example.json).

## 2. Trabalhar em uma sessão

Dentro do repositório `demo-app`, o usuário diz:

> muri-saver: o botão de login quebra no celular. Corrija e teste.

O agente consulta a memória do projeto antes de reler contexto antigo,
encontra a largura fixa e corrige o componente. O usuário confirma a regra
durável: "componentes de formulário não usam largura fixa". Essa decisão
vai para o `ai-memory` sob pedido explícito. Ao encerrar, o hook registra a
sessão no vault configurado, como em
[`claude/sessions/`](./vault/claude/sessions/), e adiciona uma entrada ao
[`diário`](./vault/dailies/).

## 3. Retomar pelo handoff

Na sessão seguinte, aberta dentro do mesmo projeto, o hook oficial do
`ai-memory` pode entregar o handoff anterior. O agente usa esse contexto e
confere a decisão durável antes de continuar. O arquivo do vault permite
inspeção humana; ele não substitui o banco de memória.

## 4. Importar sessões antigas

```bash
node bin/ingest-sessions.mjs --all --dry-run
node bin/ingest-sessions.mjs --all --limit 20
```

O primeiro comando só mostra o que seria importado. O segundo registra um
lote limitado, com mascaramento de segredos e controle para evitar duplicatas.
Veja as saídas de [`Codex`](./vault/codex/sessions/),
[`Antigravity`](./vault/antigravity/sessions/) e
[`Desktop`](./vault/desktop/sessions/). O enriquecimento por LLM é opcional
e deve ser solicitado com `--enrich`.
