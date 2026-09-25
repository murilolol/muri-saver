# Contribuindo

Obrigado por querer melhorar o muri-saver. Este guia cobre como rodar os
testes, regenerar as imagens e o que um PR precisa ter.

## Rodando localmente

```bash
git clone https://github.com/murilolol/muri-saver.git
cd muri-saver
npm test                                   # 42 testes, ~1s, zero dependências
node bin/install.mjs --dry-run --with-all  # confere o instalador sem escrever nada
node bin/ingest-sessions.mjs --all --dry-run
```

Não há `npm install`: tudo roda com Node ≥ 18 puro. Os testes usam
`node:test` e rodam cada script num `HOME` temporário, então nunca tocam na
sua instalação real.

## Regras do código

- **Zero dependências em runtime.** Se precisar de algo, use a biblioteca
  padrão do Node. `node:sqlite` é opcional e sempre com fallback.
- **Node 18 é o mínimo.** Nada de API que só existe em versões mais novas
  sem checagem (o CI roda Node 18, 22 e 24).
- **Multiplataforma de verdade.** Nada de `/` ou `\` fixo; `path.join` e
  `os.homedir()` sempre. O CI roda em macOS, Linux e Windows.
- **Hooks são autocontidos.** `hooks/*.mjs` são copiados sozinhos pra
  `~/.claude/hooks`, então não podem importar de `lib/`. Se mudar a
  sanitização em `lib/sanitize.mjs`, replique no hook.
- **Nunca apagar coisa do usuário.** Instalador e ingestor fazem backup
  antes de sobrescrever e não tocam em arquivos que o usuário editou.
- **Nada de LLM por padrão.** Qualquer chamada a modelo tem que ser opt-in e
  ter teto de custo.
- Documentação em português do Brasil; `README.en.md` acompanha o `README.md`.

## Adicionando suporte a um agente novo no ingestor

1. Crie `discover<Agente>(home)` e `parse<Agente>Session(ref)` em
   `lib/parsers.mjs`, retornando `{ refs, skippedSubagents, notes }` e
   `{ exchanges, cwd, toolCallCount, startedAt }`.
2. Registre nos `discoverAgent`/`parseSession` e em `DISCOVERABLE` do
   `bin/ingest-sessions.mjs`; adicione rótulo/ícone em `lib/vault.mjs`.
3. Adicione um fixture em `test/fixtures/home/...` com pelo menos uma
   mensagem de sistema pra filtrar e um segredo falso, e testes em
   `test/parsers.test.mjs`.

## Imagens e exemplos

`assets/` e `examples/vault/` são gerados a partir dos fixtures (sessões
fictícias, nenhum dado pessoal):

```bash
npm run assets                                  # exemplos + SVGs de terminal + screenshots
node tools/build-assets.mjs --with-llm          # + uma nota enriquecida por uma chamada real ao Haiku
node tools/build-assets.mjs --with-doctor       # + saída do doctor (precisa de um setup local real)
```

Screenshots usam Chrome/Chromium headless; sem ele, essa parte é pulada.

## Checklist do PR

- [ ] `npm test` passa
- [ ] Mudança de comportamento tem teste novo ou ajustado
- [ ] `CHANGELOG.md` atualizado na seção da próxima versão
- [ ] Documentação afetada atualizada (README, INSTALL, docs/)
- [ ] Nenhum segredo real, caminho pessoal ou dado de sessão real nos fixtures
