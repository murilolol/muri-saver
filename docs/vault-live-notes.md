# Nota viva no Obsidian

Toda sessão do Claude Code, do Codex e do Antigravity vira uma nota em
`<vault>/<agente>/sessions/`, mais uma linha no Daily cross-agente
`<vault>/dailies/Daily-AAAA-MM-DD.md`. Ninguém escreve nada à mão.

## Duas camadas

**1. Dump local (sempre, instantâneo, sem modelo).** No primeiro `Stop` da
sessão, o hook cria a nota com os metadados (comandos executados, arquivos
tocados pelo transcript e pelo `git status`, tasks) e o diálogo em texto, com
segredos mascarados. A cada `Stop` seguinte, só o bloco do dump é atualizado.

**2. Narrativa (sessões substanciais, por LLM).** Uma sessão é substancial com
2+ mensagens do usuário, 2+ minutos e (uma edição de arquivo **ou** 4+
mensagens). Aí o hook dispara um **worker destacado** (o mesmo arquivo com
`MURI_VAULT_WORKER=1`) e volta na hora; o `Stop` nunca espera o modelo. O
worker manda o transcript (segredos mascarados, tags de sistema removidas, até
200 mil caracteres, 25% do começo e 75% do fim) para a cadeia `llm.narrative` e
escreve:

- o bloco de narrativa: síntese, decisões, ações, comandos-chave, erros e
  resoluções, orientações, arquivos, próximos passos;
- a linha `↳ Narrativa` no Daily, atualizada no lugar;
- notas atômicas em `projects/<projeto>/<categoria>/` (12 categorias: bug,
  pedido, melhoria, decisão, risco...), só para projetos que já existem no vault;
- um `.canvas` ao lado da nota.

A narrativa é **regerada** a cada `narrative.intervalMinutes` (padrão 15) de
sessão, se o transcript cresceu, e uma última vez no `SessionEnd`. Um lock por
sessão impede dois workers ao mesmo tempo; se o `SessionEnd` chega com um worker
rodando, ele refaz uma passada no fim.

## O que nunca é sobrescrito

Só o que está entre os marcadores é regerado:

```markdown
<!-- auto-narrativa:start --> ... <!-- auto-narrativa:end -->
<!-- auto-dump:start --> ... <!-- auto-dump:end -->
```

Anotação sua fora desses blocos fica intacta. Nota de taxonomia que você editou
(ex.: `status: feito`) também: o hook lembra o que já gravou e não repete.
Notas de versões antigas, sem marcadores, recebem o bloco de narrativa antes da
primeira seção `##`, sem perder o conteúdo antigo.

## Codex e Antigravity

- **Codex**: o hook do Codex só repassa o payload para o mesmo pipeline. O
  rollout (`~/.codex/sessions/**/rollout-*.jsonl`) é convertido para o formato
  do Claude Code, ignorando as mensagens que o próprio Codex injeta (AGENTS.md,
  environment_context).
- **Antigravity**: não tem `SessionEnd`, então a narrativa final é a do último
  intervalo (os últimos minutos de uma conversa podem ficar de fora). O
  transcript usado é sempre o `transcript_full.jsonl`.
- **Ponte vault → ai-memory**: do Antigravity, o ai-memory só captura eventos
  de ferramenta, sem prompt nem resposta, e rejeita a sessão na consolidação. A
  narrativa do vault vira a página `narratives/<data>-antigravity-<id>.md` no
  projeto em que o ai-memory registrou a sessão. Configurável em
  `narrative.bridgeToAiMemory`; desliga com `MURI_AIM_BRIDGE=0`.

## Notas antigas sem narrativa

`muri-saver backfill --dry-run` lista as notas dos últimos 14 dias (`--since`
para mudar) que só têm dump. O job `vault-backfill` processa uma por vez, com o
primeiro modelo da cadeia (ou `llm.backfill`), e para no primeiro limite. Ver
[background-jobs.md](./background-jobs.md).

## Configuração

| Chave | Padrão | |
|---|---|---|
| `vault` | — | caminho do vault; `null` desativa tudo isto |
| `timezone` | fuso do sistema | nomes de arquivo e Dailies |
| `language` | `pt-BR` | idioma pedido ao modelo na narrativa (os títulos das seções ficam em português) |
| `llm.narrative` | ver [llm-chain.md](./llm-chain.md) | `[]` = só dump |
| `narrative.intervalMinutes` | 15 | intervalo mínimo entre regerações |
| `narrative.maxChars` | 200000 | quanto do transcript vai para o modelo |
| `narrative.bridgeToAiMemory` | `["antigravity"]` | agentes cuja narrativa vira página no ai-memory |
| `vaultIgnoreCwd` | `[]` | trechos de caminho cujas sessões não viram nota (ex.: agentes automáticos) |

## Diagnóstico

- `~/.claude/hooks/.vault-llm.log`: uma linha por narrativa gerada (modelo,
  segundos, tamanhos).
- `~/.claude/hooks/.generate-summary-error.log`: por que uma narrativa não saiu
  (todos os modelos em cooldown, JSON inválido...).
- `~/.claude/hooks/.vault-state/`: estado por sessão (última geração, itens de
  taxonomia já gravados).
