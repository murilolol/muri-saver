# Relatório de economia

`muri-saver report` (ou `python3 ~/.claude/scripts/muri-economy-report.py`)
responde à pergunta "isso está economizando de verdade?" com o que dá pra medir
na sua máquina, sem chamar modelo nem rede.

```bash
muri-saver report                 # últimos 7 dias no terminal
muri-saver report --days 14
muri-saver report --cutoff 2026-10-03T17:20:00Z   # antes × depois de uma mudança
muri-saver report --save          # também grava em <vault>/overview/economia/
muri-saver report --snapshot      # só anexa a cota atual ao histórico (job quota-snapshot)
```

## As seções

1. **Cota agora**: o cache de uso do Claude Code (`~/.claude.json`) ou, se você
   usa o app Maestri, o snapshot dele.
2. **Consumo do Claude por modelo e por dia**, em tokens-eq, lido dos transcripts
   (`~/.claude/projects/**/*.jsonl`, uma linha por mensagem, sem contar duas vezes
   o streaming; subagentes separados).
3. **Calibração**: "1% da cota semanal ≈ X tokens-eq", dividindo os tokens desde
   o início da janela pelo percentual usado. É a sua régua, não uma fórmula oficial.
4. **Custo fixo por sessão**: o 1º turno das sessões principais antes e depois de
   um corte (`--cutoff` ou `economy.cutoff` no `muri-saver.json`). Serve pra medir,
   por exemplo, quanto enxugar `CLAUDE.md` e skills economizou.
5. **Trabalho fora da cota do Claude**: delegações (`.delegations.log`), chamadas
   do shim do ai-memory por tipo de modelo, narrativas do vault e backfill.
6. **Histórico**: pico do uso semanal por semana (job `quota-snapshot`).

## Tokens-eq

Proxy do peso de cada token na cota, porque o provedor não publica a fórmula:

| Tipo | Peso | | Modelo | Fator |
|---|---|---|---|---|
| input | 1 | | Opus / Fable | 1 |
| cache write 5 min / 1 h | 1,25 / 2 | | Sonnet | 0,6 |
| cache read | 0,1 | | Haiku | 0,2 |
| output | 5 | | | |

As tabelas ficam no topo do script, pra ajustar quando os preços mudarem.

## O que a primeira medição mostrou

Numa semana real de uso pesado: **1% da cota semanal ≈ 1,3M tokens-eq**, 99%
do consumo em Opus na conversa principal, e um único dia com ~36% da semana. Ou
seja, o grosso não é o prefixo fixo (CLAUDE.md, skills), é **a quantidade de
turnos por sessão**. As alavancas que sobram: delegar leitura e pesquisa de
verdade, e sessões mais curtas com `/compact` em pontos naturais.
