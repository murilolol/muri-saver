# Troubleshooting

<p>
  <img src="https://img.shields.io/badge/primeiro_passo-node_bin%2Fdoctor.mjs-blue?style=flat-square" alt="Primeiro passo: node bin/doctor.mjs" />
</p>

Problemas que já aconteceram de verdade usando este setup, e como resolver.
**Sempre comece com `node bin/doctor.mjs`** — ele é 100% leitura e aponta a
maior parte do que está abaixo sozinho.

**Nesta página:** [Instalação](#instalação) · [Vault / Obsidian](#vault--obsidian) ·
[ai-memory](#ai-memory) · [Hooks](#hooks) · [Ingestor](#ingestor) ·
[Windows](#windows) · [Abrindo uma issue](#abrindo-uma-issue)

<br>

## Instalação

<details>
<summary><strong>"AVISO: ~/.claude/CLAUDE.md já existe — não sobrescrevi"</strong></summary>

É proposital: o instalador nunca sobrescreve um `CLAUDE.md`/`GEMINI.md`/`AGENTS.md`
que é seu. Compare com o template e copie as seções que quiser:

```bash
diff ~/.claude/CLAUDE.md claude-config/CLAUDE.md.template
```

Se o arquivo foi criado pelo próprio instalador e você não editou, o
`--update` atualiza sozinho.
</details>

<details>
<summary><strong>"não é JSON válido — não mexi nele"</strong></summary>

O instalador se recusa a mesclar hooks num `settings.json`/`hooks.json`
quebrado (pra não piorar). Corrija o JSON (vírgula sobrando é o clássico) e
rode de novo. `node -e "JSON.parse(require('fs').readFileSync('<arquivo>','utf8'))"`
mostra a linha do erro.
</details>

<details>
<summary><strong>"--update precisa de uma instalação anterior registrada"</strong></summary>

Instalações anteriores à v2 não têm `muri-saver.json`. Rode
`node bin/install.mjs` uma vez (com as flags que você usava, ex: `--vault`,
`--alias`) — isso registra tudo, e daí em diante `--update` funciona.
</details>

<details>
<summary><strong>Um <code>npx skills add</code> falhou</strong></summary>

Alguns repositórios organizam skills em subpastas e o nome curto não
resolve. Rode `npx skills find <nome-da-skill> --owner <owner>` e escolha o
pacote certo na lista. Detalhes em [`docs/skills-companion.md`](./skills-companion.md#se-um-npx-skills-add-falhar).
</details>

<details>
<summary><strong>Desinstalei e alguns arquivos ficaram</strong></summary>

O `--uninstall` só remove o que continua exatamente como o instalador
gravou. O que você editou fica, e o log lista cada um como "mantido (editado
por você)". Tudo que foi removido está em
`~/.claude/muri-saver-backups/<data>/`, espelhando os caminhos a partir da
home — pra desfazer, copie de volta.
</details>

<br>

## Vault / Obsidian

<details>
<summary><strong>As sessões não aparecem no meu vault (ou aparecem em outro lugar)</strong></summary>

1. `node bin/doctor.mjs` mostra qual vault está configurado.
2. Se você instalou a v1 com `--vault` num caminho diferente de
   `~/Documents/Obsidian Vault`, o hook daquela versão ignorava o caminho.
   Rode `node bin/install.mjs --vault "/seu/vault"` pra atualizar hook e config.
3. `OBSIDIAN_VAULT` definida no ambiente tem prioridade sobre a config —
   confira se não sobrou uma de algum teste.
</details>

<details>
<summary><strong>Datas/horários das notas estão no fuso errado</strong></summary>

O fuso vem de `--timezone` > `MURI_SAVER_TZ` > `muri-saver.json` > fuso do
sistema. Ajuste com `node bin/install.mjs --update --timezone America/Sao_Paulo`
(qualquer nome IANA vale: `Europe/Lisbon`, `UTC`...). Notas já gravadas não
são renomeadas.
</details>

<details>
<summary><strong>Nota do Obsidian "quebrou" (o resto da página sumiu)</strong></summary>

Tag HTML desbalanceada no corpo da nota. Hook e ingestor escapam tags soltas
automaticamente — se aconteceu numa nota escrita à mão, envolva o trecho num
bloco de código (` ```html `). Regra completa na seção 10 da governança
(`CLAUDE.md.template`).
</details>

<details>
<summary><strong>Obsidian não atualiza depois de <code>ai-memory reset/reorg/purge-project</code></strong></summary>

Essas operações recriam a árvore `wiki/` inteira e o watcher do Obsidian
fica preso na pasta antiga. Escritas normais aparecem ao vivo; só essas
precisam de um reload: `obsidian reload` (CLI oficial, com o app aberto) ou
reabra o vault.
</details>

<br>

## ai-memory

<details>
<summary><strong>Tudo cai no mesmo projeto genérico do ai-memory</strong></summary>

O roteamento por `repo-root` usa o diretório onde o processo começou. Abrir o
Claude Code na home e usar `/add-dir` **não muda isso** — tudo vai pro
projeto genérico. Abra direto no projeto (`cd projeto && claude`) ou crie um
`.ai-memory.toml` na raiz do repo (ver
[`docs/ai-memory-obsidian-setup.md`](./ai-memory-obsidian-setup.md#3-marker-file-por-projeto-ai-memorytoml)).
O hook `ai-memory-ensure-server.mjs` avisa quando a sessão começa na home.
</details>

<details>
<summary><strong>O login do Claude Code quebrou depois de configurar o LLM do ai-memory</strong></summary>

Sintoma: status "Claude API" em vez de Pro/Max, erro 401 em "remote managed
settings". Causa: `CLAUDE_CODE_OAUTH_TOKEN` definida globalmente — é a mesma
variável que o `claude` usa pra se autenticar. Remova essa variável e use
`ANTHROPIC_OAUTH_TOKEN`, que é exclusiva do ai-memory.
</details>

<details>
<summary><strong>"servidor ai-memory não está de pé"</strong></summary>

Normal antes da primeira sessão: o hook `SessionStart` sobe o servidor sob
demanda. Se continuar fora, confira se o binário está em `~/.local/bin`
(macOS/Linux) ou `~/.cargo/bin` (Windows), ou no `PATH`.
</details>

<br>

## Hooks

<details>
<summary><strong>O <code>/exit</code> demora</strong></summary>

O hook `Stop` tem teto de ~8s pra chamada `claude -p`; se estourar, cai no
fallback local e marca rate-limit por 15 minutos (as próximas saídas ficam
instantâneas). Erros ficam em `~/.claude/hooks/.generate-summary-error.log`.
Com o modo muri-saver ativo, o encerramento é sempre local e instantâneo.
</details>

<details>
<summary><strong>Colei uma chave num prompt. Ela foi pro vault?</strong></summary>

Desde a v2, não crua: hook e ingestor gravam `[REDACTED:TIPO]` no lugar
(Anthropic, OpenAI, GitHub, AWS, Slack, Google, JWT, `Bearer`, senhas,
chaves privadas). Notas gravadas pela v1 **não** tinham isso — procure no
vault por `sk-`, `ghp_`, `AKIA` e remova à mão. E revogue a chave: ela
passou pelo agente de qualquer forma.
</details>

<br>

## Ingestor

<details>
<summary><strong>Uma sessão não foi importada</strong></summary>

Causas comuns, na ordem:
- Já estava no cache (`~/.claude/cache/.muri-saver-ingested.json`) — use `--force`.
- Era de um subagente — use `--include-subagents`.
- Ficou fora do `--since`/`--limit`.
- Não tinha nenhum prompt real (só comandos como `/clear`) — conta como "sem conteúdo".
- O hook já tinha registrado a mesma sessão no vault — o ingestor não duplica.
</details>

<details>
<summary><strong>"node:sqlite indisponível"</strong></summary>

Só o SQLite do Codex depende disso (precisa de Node ≥ 22.5). Os rollouts
`.jsonl` do Codex continuam sendo lidos normalmente; o SQLite só acrescenta
títulos, `cwd` confiável e threads cujo `.jsonl` foi apagado.
</details>

<details>
<summary><strong><code>--enrich</code> falhou e gravou só o dump</strong></summary>

A chamada `claude -p` falhou (não logado, cota da janela de 5h, timeout) —
o ingestor cai no dump local e mostra o motivo. A sessão fica no cache;
pra tentar enriquecer de novo, rode com `--force`.
</details>

<br>

## Windows

<details>
<summary><strong>A status line não aparece</strong></summary>

O `statusLine` padrão chama `python3`, que muitas vezes não existe no
Windows (só `python`). Troque o comando no `~/.claude/settings.json` pra
`python %USERPROFILE%\.claude\scripts\statusline.py`. O `doctor` avisa
quando só encontra `python`.
</details>

<details>
<summary><strong>Emojis/acentos aparecem quebrados no terminal</strong></summary>

Use o Windows Terminal (não o `cmd` clássico) ou rode `chcp 65001` antes. Os
scripts já forçam UTF-8 na saída.
</details>

<br>

## Abrindo uma issue

Se nada acima resolveu, abra uma issue com a saída do `node bin/doctor.mjs`
(tire caminhos que você não quiser expor), o SO, `node --version` e qual
agente estava usando: <https://github.com/murilolol/muri-saver/issues/new/choose>.
