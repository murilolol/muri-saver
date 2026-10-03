# Contribuindo

Valeu pelo interesse! Bug, regra melhor, suporte a outro agente ou SO: tudo é
bem-vindo.

## Antes de abrir um PR

```bash
git clone https://github.com/murilolol/muri-saver.git
cd muri-saver
npm test                                   # node:test, zero dependências, < 2 s
node bin/install.mjs --dry-run --with-all  # o instalador não escreve nada
node bin/doctor.mjs                        # 100% leitura
```

- **Zero dependências.** Só módulos do Node (>= 18) e, para dois scripts, Python 3
  da biblioteca padrão.
- **Multiplataforma.** Nada de `/Users/...`, `C:\...` ou `~` fixo no código: use
  `os.homedir()`, `path.join` e `hooks/muri-common.mjs` (`resolveBin`,
  `aiMemoryPaths`, `appendLog`). Nada de `[ ... ] ||`, `lsof` ou `perl` em código
  que o Windows precisa rodar. CLIs do npm no Windows são `.cmd`: passe por
  `bin()`/`resolveBin()`.
- **Hooks nunca falham a sessão do agente.** Erro vira uma linha no stderr ou no
  log e o hook sai com 0.
- **Nada de segredo ou dado pessoal** em código, fixtures ou exemplos. Exemplos
  usam dados fictícios (`examples/vault/`, `test/fixtures/`).
- **Testes herméticos.** O helper (`test/_helpers.mjs`) roda tudo numa home
  temporária, com o agendador em modo `dry` e a cadeia de LLMs desligada. Teste que
  precisa de modelo usa os binários falsos de `tools/test-bin/`. Não coloque `.mjs`
  executável dentro de `test/`: o `node --test` trata como arquivo de teste.
- **Comentários** explicam o porquê, em português, na densidade do código ao redor.

## Estrutura

| Pasta | O que tem |
|---|---|
| `bin/` | comandos: `cli`, `install`, `doctor`, `audit`, `ingest-sessions` |
| `lib/` | lógica dos comandos (só roda a partir do repo) |
| `hooks/` | o que é instalado em `~/.claude/hooks` (inclui `muri-common.mjs` e `muri-llm.mjs`, compartilhados com os scripts) |
| `scripts/` | o que é instalado em `~/.claude/scripts` (shim, jobs, delegate, relatório...) |
| `skills/` | skills próprias (`muri-saver`, `grill-me`) e páginas das companheiras |
| `*-config/` | templates de governança e snippets de hooks por agente |
| `docs/` | documentação por assunto |
| `test/`, `tools/test-bin/` | suíte e binários falsos |

## Mensagens de commit

Curtas, no imperativo, dizendo o que muda pro usuário
(`Corrige narrativa que não saía no Codex`, `Add Linux crontab fallback`).

## Reportando bug

Use o template de issue. Inclua a saída do `node bin/doctor.mjs` e o trecho
relevante de `~/.claude/hooks/*.log`, **revisando antes** se não há caminho ou
dado seu que você não queira publicar.
