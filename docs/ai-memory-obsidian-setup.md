# ai-memory + Obsidian

O [ai-memory de AkitaOnRails](https://github.com/akitaonrails/ai-memory) é uma
dependência externa. Captura, busca e handoff podem funcionar sem provedor de
LLM. O muri-saver acrescenta governança, instalação dos próprios hooks e
registro opcional em um vault; não instala nem substitui o daemon. Testado com o
ai-memory 3.2.x.

## 1. Instalar e conferir os comandos

Siga a [instalação oficial](https://github.com/akitaonrails/ai-memory/blob/main/docs/install.md)
para sua plataforma. Antes de alterar a configuração existente:

```bash
ai-memory --version
ai-memory install-hooks --help
ai-memory install-mcp --help
```

Para registrar os hooks oficiais do Claude Code:

```bash
ai-memory install-hooks --agent claude-code --apply
```

Escolha o agente real conforme o help instalado para outros clientes.
Os hooks do ai-memory capturam observações sanitizadas e limitadas; não são
uma cópia integral do transcript. Os hooks de Obsidian deste projeto são
independentes. Preserve ambos quando sua configuração usar os dois.

## 2. MCP e identidade da sessão

Para o Claude Code, a ponte documentada encaminha o session ID real:

```bash
ai-memory install-mcp --client claude-code --session-aware --apply
```

Consulte [auto-scope](https://github.com/akitaonrails/ai-memory/blob/main/docs/auto-scope.md)
para os modos suportados; não substitua um modo existente apenas por seguir
um exemplo antigo. Instalar hooks, sozinho, não torna o MCP session-aware.

| Cliente | Escopo nas chamadas |
|---|---|
| Session-aware com ID real encaminhado | Pode omitir workspace/project do repositório atual conforme o contrato da ferramenta |
| MCP estático sem essa ponte | Deve passar workspace e project juntos, com nomes explicitamente confirmados |

Clientes estáticos nunca devem adivinhar nomes pela pasta nem usar o último
projeto ativo do servidor. A ponte acima é do Claude Code; confirme o suporte
real antes de aplicar a outro agente.

## 3. Identidade explícita e histórico

Um marker é opcional. Se quiser usá-lo, declare os dois nomes reais:

```toml
# .ai-memory.toml — substitua por identidades confirmadas
workspace = "meu-workspace"
project = "meu-projeto"

[capture]
ignore_paths = ["node_modules/**", ".env", "**/.env", ".git/**", "dist/**"]
```

Veja [marker-file](https://github.com/akitaonrails/ai-memory/blob/main/docs/marker-file.md).
Com project explícito, project_strategy não escolhe outro nome. O marker
orienta a resolução dos hooks/CLI; clientes MCP estáticos ainda precisam
enviar o par na chamada.

Sem marker, o destino depende da estratégia/configuração real. Uma consulta
vazia não prova que existe um bucket genérico. Busque um histórico antigo
somente em um par workspace/project confirmado e com termos do assunto.
Quando apropriado, uma busca global pode descobrir o escopo; omita
workspace/project/scopes nessa chamada. O nome `muri` não é um padrão público.

Se SessionStart já entregou um handoff, use esse conteúdo: ele normalmente
já foi consumido. Sem esse bloco, liste os handoffs no escopo confirmado e
aceite o ID exato. Grave páginas duráveis manualmente só sob pedido explícito.

## 4. Roteamento curto, detalhes sob demanda

O ai-memory 3.2.x oferece preview das instruções compactas e das skills
gerenciadas; confirme as flags no help da sua versão:

```bash
ai-memory install-instructions --compact --print
ai-memory install-skills --print
```

Revise o preview antes de aplicar. Atualize somente o bloco com markers e
arquivos gerenciados pelo ai-memory; preserve regras pessoais e skills de
terceiros. O muri-saver não reimplementa esses schemas dentro dos templates.

## 5. Obsidian opcional

Ative o vault escolhido depois de revisar a instalação:

```bash
node bin/install.mjs --dry-run --with-all --vault "/caminho/absoluto/Vault"
node bin/install.mjs --with-all --vault "/caminho/absoluto/Vault"
node bin/doctor.mjs
```

O caminho/fuso ficam em `~/.claude/muri-saver.json`; hooks e ingestor os
respeitam. Sem vault configurado na instalação pública, essa camada fica
inativa. Uma configuração pessoal que exige Obsidian deve continuar ativa.

O MCP Obsidian também é opcional: mescle só a entrada de
[mcp/obsidian.optional.example.json](../mcp/obsidian.optional.example.json),
com seu caminho real. Preserve as demais entradas e a ponte do ai-memory.

## 6. LLM da consolidação

Sem provedor de LLM, o ai-memory **captura** as sessões mas nunca as
consolida em páginas da wiki. O muri-saver oferece uma cadeia de modelos com
troca automática em limite/erro, servida por um shim local:

```bash
node bin/cli.mjs llm chain    # ai-memory → shim 127.0.0.1:49380 → cadeia llm.aiMemory
node bin/cli.mjs llm tune     # limites recomendados (entrada maior, scheduler sem rajada)
node bin/cli.mjs llm status   # provedor ativo e estado de cada modelo
node bin/cli.mjs jobs install llm-shim finalize-idle reprocess-parked
```

O guia completo (tipos de modelo, chave da API para serviços, tabela de
limites) está em [llm-chain.md](./llm-chain.md). Pontos que mais pegam:

- **Sessões abertas para sempre**: o auto-improve só consolida sessão
  encerrada, e o Antigravity não emite `SessionEnd`. O job `finalize-idle`
  encerra as ociosas há mais de 2h.
- **Sessões estacionadas**: quando toda a cadeia esgota, o ai-memory desiste
  da sessão (`parked=true`). O job `reprocess-parked` refaz depois.
- **Conteúdo do Antigravity**: o ai-memory só vê eventos de ferramenta dele;
  a narrativa do vault vira página `narratives/` (ponte vault → ai-memory).
- **Sessões-lixo**: chamadas headless do `agy` disparam os hooks do ai-memory;
  o instalador embrulha esses hooks com o `aim-guard`. Se você reinstalar os
  hooks do ai-memory no Antigravity, rode `node bin/install.mjs --update`.
- **Ver a wiki no Obsidian**: um link simbólico de `<vault>/ai-memory` para a
  pasta `wiki/` do ai-memory (caminho em `ai-memory status --json`) mostra as
  páginas ao vivo; editar no Obsidian edita a wiki. No Windows, use uma
  junction (`mklink /J`).

Verificação:

```bash
ai-memory llm-test --help
node bin/doctor.mjs
node bin/cli.mjs audit --instructions-only
```

## 7. Servidor, recuperação e upgrade

**Quem sobe o servidor.** No Claude Code, o hook SessionStart
`ai-memory-ensure-server.mjs` do muri-saver sobe o `ai-memory serve` sob
demanda. Codex e Antigravity não têm esse hook: com o servidor fora, os hooks
do ai-memory gravam num spool local e nada se perde, mas busca e handoff ficam
sem resposta até ele voltar. Para mantê-lo sempre de pé existe o
`ai-memory setup`: roda o `init`, instala um serviço de usuário (systemd
`--user` ou LaunchAgent) e configura hooks, MCP e skills de todo agente que
detectar. Ele mostra o plano e pergunta antes (salvo com `--yes`). Como
reescreve os hooks, rode `node bin/install.mjs --update` depois, para o
aim-guard voltar aos hooks do Antigravity.

**Depois de uma queda.** `ai-memory recover` esvazia o spool dos hooks,
reprocessa os transcripts das sessões que rodaram com o servidor fora e termina
as importações que falharam. Pode rodar mais de uma vez.

**Upgrade.** O muri-saver lê o SQLite interno do ai-memory (`finalize-idle` e a
ponte da nota viva) e foi testado com a 3.2.x. Para trocar de versão:

```bash
ai-memory backup                # snapshot de wiki/, db/ e config.toml
ai-memory upgrade               # troca o binário e reaplica os hooks dele
node bin/install.mjs --update   # religa o aim-guard que o upgrade tirou
node bin/doctor.mjs             # versão, schema do SQLite e aim-guard
```

O `upgrade` só vale para a instalação nativa pelo release do GitHub; Homebrew,
AUR e afins atualizam pelo próprio gerenciador (depois, os mesmos dois últimos
passos). Se o `doctor` disser "schema do ai-memory diferente do esperado", os
jobs que leem o banco podem falhar nessa versão: volte com
`ai-memory upgrade --version 3.2.0` (ou `ai-memory restore` do backup) e abra
uma issue.

## English quick reference

Use official ai-memory installation and the current CLI help. Lifecycle hooks
do not make a static MCP client session-aware. Static calls require an explicit
workspace/project pair; never hardcode a historical bucket. The Claude Code
session-aware bridge forwards the real lifecycle ID. Preview compact managed
instructions and skills before applying them. Obsidian and model enrichment
are optional for public installs; preserve existing personal integrations.

Server, recovery and upgrade: in Claude Code the muri-saver SessionStart hook
starts `ai-memory serve` on demand; Codex and Antigravity have no such hook, so
their ai-memory hooks spool locally while the server is down. `ai-memory setup`
installs a user service (systemd `--user` or LaunchAgent) plus hooks, MCP and
skills for every detected agent; it rewrites hooks, so run
`node bin/install.mjs --update` afterwards to restore the aim-guard.
`ai-memory recover` drains the spool after an outage and is safe to re-run.
muri-saver reads ai-memory's internal SQLite and is tested with 3.2.x. To
upgrade: `ai-memory backup`, `ai-memory upgrade` (GitHub-release installs only),
`node bin/install.mjs --update`, then `node bin/doctor.mjs`, which reports the
version, the SQLite schema and the aim-guard.
