# Roadmap

O que já foi feito (com o problema real que motivou cada item) e o que ainda
está pela frente. Sugestões são bem-vindas em
[issues](https://github.com/murilolol/muri-saver/issues).

## ✅ Feito na v2.0

### Funcionalidades

| Melhoria | Problema que resolve | Onde |
|---|---|---|
| Vault e fuso lidos do `muri-saver.json` pelos hooks | `--vault` criava pastas num lugar e o hook gravava em outro | `hooks/obsidian-vault-check.mjs`, `hooks/codex/obsidian-codex-session.mjs` |
| Config + manifesto (`muri-saver.json`) | Nenhum registro do que foi instalado, alias descoberto por busca de texto | `lib/config.mjs`, `bin/install.mjs` |
| `--update` | Reinstalar exigia repetir todas as flags e empilhava backups | `bin/install.mjs` |
| `--uninstall` | Não havia como remover sem caçar arquivos à mão | `bin/install.mjs` |
| `--timezone` | Fuso de São Paulo fixo no código | `bin/install.mjs`, hooks, ingestor |
| Mascaramento de segredos no hook ao vivo | Chaves coladas em prompts iam cruas pro vault | `hooks/obsidian-vault-check.mjs` |
| SQLite do Codex via `node:sqlite` | Histórico do Codex no SQLite era ignorado | `lib/parsers.mjs` |
| Subagentes pulados por padrão | Cada subagente virava uma "sessão" avulsa | `lib/parsers.mjs` |
| `--enrich` com teto de custo | Import retroativo só tinha dump bruto, sem taxonomia | `lib/enrich.mjs` |
| `--source-home` | Importar a home de outra máquina (ex: Windows antigo) | `bin/ingest-sessions.mjs` |
| Comando único + pacote npm | Só dava pra usar clonando | `bin/cli.mjs`, `package.json` |
| Testes + CI em 3 SOs | "Multiplataforma" só testado em macOS | `test/`, `.github/workflows/ci.yml` |

### Documentação

| Melhoria | Onde |
|---|---|
| Screenshots reais (status line, install, doctor, ingestor) | `assets/terminal-*.svg` |
| Renderização das notas geradas | `assets/vault-*.png` |
| Vault de exemplo navegável | [`examples/vault/`](./examples/vault/) |
| Diagrama de arquitetura v2 | `assets/architecture-diagram.{svg,png}` |
| Troubleshooting consolidado | [`docs/troubleshooting.md`](./docs/troubleshooting.md) |
| CHANGELOG + tags de versão | [`CHANGELOG.md`](./CHANGELOG.md) |
| README em inglês | [`README.en.md`](./README.en.md) |
| Guia de contribuição | [`CONTRIBUTING.md`](./CONTRIBUTING.md) |

## 🔜 Próximos passos

| Ideia | Por quê | Esforço |
|---|---|---|
| Publicar no npm (`npx muri-saver`) | O pacote já está pronto; falta `npm login && npm publish` por quem mantém | pequeno |
| Status line equivalente pro Antigravity dentro do repo | Hoje o renderizador do Antigravity mora só na máquina do autor | médio |
| `--project <nome>` no ingestor | Importar só as sessões de um projeto específico | pequeno |
| Ordenar entradas do diário por horário | Hoje ficam na ordem em que foram gravadas (hook e ingestor intercalam) | pequeno |
| Hook do Codex com dump de prompts | Hoje o hook do Codex só registra metadados; o ingestor já sabe extrair o conteúdo | médio |
| Dashboard `.base` do Obsidian no `examples/` | Mostrar a taxonomia por projeto como tabela viva | pequeno |
| Suporte a Cursor/OpenCode no ingestor | Mesmo padrão dos parsers existentes | médio |
| Consolidar hook e `lib/` num bundle gerado | Hoje a sanitização existe em dois lugares (o hook precisa ser autocontido) | médio |
