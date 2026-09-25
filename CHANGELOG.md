# Changelog

Todas as mudanças relevantes deste projeto. Formato baseado em
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), versões seguindo
[SemVer](https://semver.org/lang/pt-BR/).

## [2.0.0] — 2026-09-25

Versão focada em tornar o muri-saver confiável pra qualquer pessoa instalar,
atualizar e remover — não só na máquina de quem escreveu.

### Corrigido
- **Vault configurado era ignorado pelo hook.** `hooks/obsidian-vault-check.mjs`
  gravava sempre em `~/Documents/Obsidian Vault`, mesmo instalando com
  `--vault` em outro caminho. Agora hooks (Claude Code, Antigravity e Codex)
  e o ingestor leem o vault de `muri-saver.json`, com `OBSIDIAN_VAULT` como
  override.
- **Segredos iam sem máscara pro vault.** O hook ao vivo só escapava HTML;
  qualquer chave colada num prompt ia crua pro dump. Agora hook e ingestor
  mascaram chaves Anthropic/OpenAI/GitHub/AWS/Slack/Google, JWT, `Bearer`,
  senhas e chaves privadas como `[REDACTED:TIPO]`.
- **Segredo e tag cortados ao meio.** Título e resumo eram cortados
  (80/140 caracteres) *antes* da sanitização, então um token pela metade ou
  um `</USER_REQUE…` escapavam do filtro. Agora limpa primeiro, corta depois.
- **Marcador de redação quebrava o Markdown.** `***REDACTED-…***` renderizava
  como negrito+itálico; trocado por `[REDACTED:TIPO]`.
- **Diário fora de ordem.** Entradas novas em diários criados pelo hook antigo
  (sem o marcador `<!-- ENTRIES -->`) iam parar depois da seção "Conexões
  Globais". Agora entram dentro de "Sessões do Dia", e o hook preserva o
  marcador ao criar o diário.
- **Títulos quebrando o frontmatter.** Títulos das notas do hook iam sem aspas
  no YAML (um `: ` no prompt quebrava a nota); agora são sempre escapados.
- **`<HOME>` com barra invertida gerava JSON inválido no Windows** ao mesclar
  os snippets de hooks.
- **`cwd` do Codex em formato Windows** (`C:\Users\...\projeto`, comum em
  histórico migrado) virava um "projeto" com o caminho inteiro no nome.
- **Id da sessão do Codex truncado** (só os últimos 12 caracteres do UUID).
- **Mensagens injetadas pelo Codex** (`AGENTS.md instructions`,
  `<environment_context>`) eram importadas como se fossem prompts do usuário.
- `git status` dos hooks vazava "fatal: not a git repository" no stderr.
- Slugs de notas de taxonomia terminavam em `-` quando cortados.
- Alias de uma palavra só (`--alias lucas`) gerava gatilhos repetidos
  (`"lucas", "lucas" ou "/lucas"`).

### Adicionado
- **`~/.claude/muri-saver.json`**: alias, vault, fuso, agentes, caminhos e um
  manifesto com sha256 de cada arquivo instalado.
- **`install.mjs --update`**: reinstala reaproveitando a config salva;
  atualiza arquivos de governança criados pelo instalador e não editados.
- **`install.mjs --uninstall`**: remove só o que não foi editado, move tudo
  pra `~/.claude/muri-saver-backups/<data>/` e tira as entradas de hook dos
  `settings.json`/`hooks.json`.
- **`install.mjs --timezone`** (padrão: fuso do sistema) — antes era
  `America/Sao_Paulo` fixo.
- **`bin/cli.mjs`**: comando único `muri-saver <install|update|uninstall|doctor|ingest>`,
  funciona com `npx github:murilolol/muri-saver`.
- **Ingestor**: `--enrich` (narrativa + taxonomia via Haiku, opt-in, com
  `--enrich-limit` e teto de US$ 0,20 por chamada), `--include-subagents`,
  `--source-home` (importar backup de outra máquina), `--timezone`, leitura do
  SQLite do Codex via `node:sqlite` (índice de threads + threads sem rollout),
  leitura em streaming (rollouts de 100MB+).
- **Doctor**: seção do `muri-saver.json` (versão, alias, fuso, agentes,
  integridade por sha256), checagem de Node ≥ 18 e de `node:sqlite`.
- **Testes**: 42 testes com `node:test` e fixtures de cada agente;
  **CI** no GitHub Actions em macOS, Linux e Windows × Node 18/22/24.
- **Documentação**: screenshots reais (status line, install, doctor,
  ingestor, notas do vault), [`examples/vault/`](./examples/vault/),
  [`docs/troubleshooting.md`](./docs/troubleshooting.md),
  [`ROADMAP.md`](./ROADMAP.md), [`CONTRIBUTING.md`](./CONTRIBUTING.md),
  [`README.en.md`](./README.en.md), diagrama de arquitetura v2.
- `tools/build-assets.mjs` regenera exemplos e imagens a partir dos fixtures.

### Mudado
- Lógica compartilhada movida pra `lib/` (config, alias, sanitização,
  parsers, vault, enriquecimento); os hooks continuam autocontidos.
- Reinstalar sem mudanças não escreve nada nem cria backup; backups de uma
  execução ficam todos numa pasta só, e só são feitos quando o arquivo
  existente não é exatamente o que o instalador gravou antes.
- Transcrições de subagentes (Claude Code e Codex) são puladas por padrão.
- Projeto de sessões do Antigravity inferido ignorando pastas genéricas
  (`src`, `app`, `components`…) — `/landing-page/src/Hero.tsx` vira
  `landing-page`, não `src`.
- Import em modo `--export-dir` não grava mais no cache de idempotência.
- `.gitignore` agora ignora `.ai-memory`, `.impeccable` e `*.tgz`.

## [1.2.0] — 2026-09-23

### Adicionado
- Seção de status line no README com a saída real e explicação de cada segmento.

### Mudado
- Revisão visual de toda a documentação: badges, callouts, seções
  colapsáveis, páginas das skills companheiras num formato único.

## [1.1.0] — 2026-09-23

### Adicionado
- `--alias`/`--author-name` no instalador: renomeia a skill e os gatilhos
  mantendo `muri-saver` como alias alternativo.
- `bin/ingest-sessions.mjs`: primeira versão do ingestor de sessões antigas.
- `antigravity-config/GEMINI.md.template` e `codex-config/AGENTS.md.template`.
- `--with-antigravity` e `--with-all` no instalador.
- Onboarding `/grill-me` no `INSTALL-AI.md`.

## [1.0.0] — 2026-09-23

Primeira versão pública: governança `CLAUDE.md`, skills `muri-saver` e
`grill-me`, hooks de ciclo de vida (Claude Code, Antigravity, Codex),
status line e scripts de uso, instalador multiplataforma, `doctor`,
exemplo de MCP, documentação e páginas das skills companheiras.

[2.0.0]: https://github.com/murilolol/muri-saver/compare/e107ef7...v2.0.0
[1.2.0]: https://github.com/murilolol/muri-saver/compare/9df2678...e107ef7
[1.1.0]: https://github.com/murilolol/muri-saver/compare/4452a53...9df2678
[1.0.0]: https://github.com/murilolol/muri-saver/commits/4452a53
