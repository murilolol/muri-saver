# Auditoria local

[English](./audit.en.md)

O `audit` transforma contadores disponíveis e chamadas de ferramentas em um
relatório por sessão. Não usa LLM, rede nem grava arquivos. Precisa de Node ≥18.

```bash
node bin/cli.mjs audit --instructions-only
node bin/cli.mjs audit --agent claude --limit 3
node bin/cli.mjs audit --file ./session.jsonl --json
```

Sem `--file`, procura os JSONL de Claude Code, Codex e Antigravity e lê as
cinco sessões mais recentes no total. `--agent` restringe a origem e `--limit`
aceita 1–100. `--source-home <pasta>` permite auditar um backup. Subagentes
conhecidos e threads Codex somente em SQLite são pulados.

O relatório mostra tamanho das instruções globais em caminhos padrão,
duplicatas exatas, contadores de tokens quando disponíveis, chamadas por
ferramenta e até dez grupos de chamadas com argumentos idênticos. Evidências
indicam as linhas do JSONL e uma assinatura hash; não imprimem argumentos.
Depois de uma edição reconhecida, começa um novo intervalo de comparação.
Uma chamada repetida pode ser necessária: o relatório não prova desperdício.

| Origem | Contagem |
|---|---|
| Claude | Última usage por message ID; input inclui cache read e cache creation |
| Codex | Último total cumulativo; cache já está no input e reasoning no output |
| Antigravity | Chamadas de ferramentas; tokens desconhecidos neste parser |

Contadores ausentes ficam desconhecidos. Sem os contadores de cache Claude,
`inputComplete=false` e input/total são parciais. O pico de input informado por uma
requisição não é um contador atual de contexto. O intervalo entre timestamps
não mede tempo ativo. Bytes/palavras não são tokens; tokens não estabelecem
preço nem percentual da quota de assinatura. Caminhos, aliases personalizados
e arquivos de instruções fora dos caminhos padrão podem exigir comparação
manual.

Prompts, argumentos e conteúdo das instruções não entram no relatório.
Caminhos e nomes de ferramentas ainda podem ser privados; revise antes de
compartilhar. Arquivos ilegíveis falham explicitamente; linhas JSON inválidas
são contadas e ignoradas. O formato do transcript pode mudar entre versões.

## Comparar antes e depois

1. Fixe checkout, tarefa, modelo, esforço, ferramentas e critérios de qualidade.
2. Execute em sessões novas equivalentes, com e sem a skill, repetindo os casos.
3. Guarde localmente os dois relatórios e o resultado das verificações.
4. Compare correção junto com tokens/tempo e declare diferenças de cache.

As auditorias históricas do README motivam as regras; não demonstram uma
economia percentual causada pela skill. A versão 2.1 reduz o texto dos
templates, mas não promete um percentual de economia em sessões reais.
