# Delegação multi-agente

O agente principal (normalmente o Claude Code, o "maestro") planeja, decide,
revisa e conversa. Trabalho mecânico ou pesado vai para outro agente, rodando
headless **na cota dele**, e só um resumo curto volta para o contexto do maestro.

```bash
node ~/.claude/scripts/muri-delegate.mjs gemini "explique como o módulo de auth valida tokens"
node ~/.claude/scripts/muri-delegate.mjs gemini --effort low --file erro.log "resuma este log em 10 linhas"
node ~/.claude/scripts/muri-delegate.mjs codex "revise o diff atual: bugs, regressões, testes faltando"
node ~/.claude/scripts/muri-delegate.mjs codex --write "adicione testes para lib/parsers.mjs cobrindo X e Y"
```

| Delegado | Roda | Bom para |
|---|---|---|
| `gemini` | `agy` (Antigravity CLI), Gemini Flash | varredura ampla, "como X funciona", resumo de log, pesquisa, rascunho de doc |
| `codex` | `codex exec`, sandbox real | revisão somente leitura; com `--write`, implementação bem especificada |

## Regras de segurança embutidas

- **Somente leitura por padrão.** O script compara o `git status` antes e depois;
  se o delegado alterou algo, mostra o diff e sai com código 3.
- **Escrita só pelo Codex**, com `--write`, que exige `git status` limpo (pra o
  diff do delegado ficar isolado) e nunca faz commit.
- **Sem recursão**: o delegado roda com `MURI_DELEGATE=1` e qualquer tentativa de
  delegar de novo sai com código 64.
- **Sem lixo de memória**: a execução também leva `MURI_SAVER_OBSIDIAN_GEN=1` e
  `MURI_AIM_NOCAPTURE=1`, então não vira nota no vault nem sessão no ai-memory.
- **Cota esgotada** sai com 75: o maestro troca gemini↔codex ou usa um subagente
  barato.

O prompt vai pelo stdin (um brief grande com `--file` não estoura o limite de
argumentos do Windows). A resposta completa fica num arquivo temporário; o
stdout traz no máximo `--lines` linhas (padrão 60).

Cada chamada vira uma linha em `~/.claude/scripts/.delegations.log` e aparece no
[relatório de economia](./economy-report.md).

## O que não delegar

Uma ou duas chamadas de ferramenta (delegar custa mais), nuance que só existe na
conversa atual, segredos e `.env`, operação destrutiva, servidores de produção.
Brief bom é autocontido: objetivo, caminhos, restrições e o que conta como pronto.

A skill `muri-saver` traz a tabela completa de "quem faz o quê" em
`references/delegation.md`.
