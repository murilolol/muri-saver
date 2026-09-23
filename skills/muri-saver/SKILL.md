---
name: muri-saver
description: Modo de economia agressiva de tokens, custo e limites de uso (5h/diário/semanal). Ao digitar "muri saver", "muri-saver" ou "/muri-saver" UMA ÚNICA VEZ em qualquer prompt, o modo torna-se STICKY (PERMANENTE) para toda a conversa a cada prompt subsequente, sem necessidade de redigitar. O agente passa a governar modelo, verbosidade, tool calls e gestão de sessão de forma contínua até o usuário dizer explicitamente "sair do muri-saver" ou "desativar muri-saver". Inclui o protocolo nativo interativo /grill-me com 5 a 10+ perguntas via ask_question / AskUserQuestion.
---

# muri-saver

Modo de economia agressiva. Baseado em análise real de 31 sessões / ~37k mensagens do
histórico de muri: o vilão dominante NÃO é escolha de modelo (Opus é <1% do uso) — é
**sessões maratona** (uma sessão sozinha consumiu 2,1 bilhões de tokens de cache em
42h/7059 mensagens), **releitura repetida do mesmo arquivo** (arquivos lidos 30-54x na
mesma sessão), **effort xhigh aplicado por padrão a tudo**, e **screenshots/tool-schemas
recarregados** sem necessidade. Segunda auditoria via `/doctor` (2026-08-30, scan de 50
transcripts recentes / ~66k linhas) confirmou o mesmo padrão e achou um vilão adicional
específico de browser automation: **501 chamadas de `computer` (screenshot) contra
apenas 3 de `get_page_text`/`read_page` (texto)** no mesmo intervalo — a regra de
"prefira texto" já existia abaixo mas só valia com o modo ativado; foi promovida pro
`CLAUDE.md` global (sempre ativa) por causa disso. A mesma auditoria confirmou que a
lista de skills/plugins desativados já está bem curada (nada novo pra desligar) — o
gargalo real continua sendo comportamento de sessão, não configuração. As regras abaixo
atacam exatamente isso.

Ao ativar, primeiro classifique a tarefa (backend / frontend / docs / git / debug /
projeto novo / refactor) a partir do prompt do usuário e aplique a seção correspondente
abaixo. Regras universais valem sempre.

## Regras universais (sempre, independente do tipo de tarefa)

**Resposta**
- Sem preâmbulo, sem recapitular o pedido, sem resumo final além de 1-2 frases.
- Não repita código/conteúdo de arquivo que já apareceu nesta sessão.
- Não ofereça opções que o usuário não pediu; vá direto à implementação.

**Leitura de arquivos**
- Prefira Grep/Glob a Read de arquivo inteiro. Se só precisa confirmar um trecho, use
  `offset`/`limit` no Read em vez do arquivo todo.
- **Nunca releia um arquivo já lido nesta sessão**, a menos que você mesmo o tenha
  editado desde então ou haja motivo concreto para achar que mudou externamente. Confie
  no que já está no contexto. (Isso sozinho foi o padrão mais caro encontrado no
  histórico: um arquivo re-lido 42 vezes numa única sessão.)
- Antes de reler um arquivo grande ou re-explicar contexto/decisões já tomadas nesta
  sessão ou em sessões anteriores, tente `memory_query` (ai-memory) primeiro — pode já
  ter a resposta sem gastar tokens de releitura. Ver "Memória persistente (ai-memory)"
  abaixo.
- Ao editar, prefira Edit cirúrgico a Write de arquivo inteiro. Write só para arquivo
  novo ou reescrita total genuinamente necessária.

**Memória persistente (ai-memory) & Grafo Obsidian**
- **Regra First-Look (Memória Primeiro)**: SEMPRE consulte o `ai-memory` via `memory_query`
  ou `memory_explore` ANTES de reler arquivos grandes de código ou documentação, ou antes de
  pedir pro usuário reexplicar decisões passadas. Foi comprovado na prática: consultar a
  memória consome tokens residuais e evita que o contexto cresça, fazendo com que o agente
  não gaste quase nada de cota e preserve o limite de 5 horas.
- **Feedback Explícito em 1 Linha**: Sempre que consultar a memória no início de uma resposta,
  inclua uma linha de confirmação clara e objetiva:
  `🧠 Memória consultada: X registros encontrados para [tópico]`
- **Regra de Gravação Incremental & Centrais Dedicadas (`antigravity/` e `claude/`)**:
  - Toda gravação no `ai-memory` e no Obsidian Vault é **estritamente cumulativa e incremental**.
    NUNCA substitua, apague ou resuma destrutivamente o histórico anterior.
  - **Centrais Dedicadas no Obsidian Vault**:
    - **Antigravity (AGY)**: Toda sessão deve ser gravada em `antigravity/sessions/Session-YYYY-MM-DD_HHhMM-AGY-<id>.md`
      e registrada na linha do tempo `antigravity/dailies/Daily-YYYY-MM-DD.md`.
    - **Claude Code**: Toda sessão deve ser gravada em `claude/sessions/Session-YYYY-MM-DD_HHhMM-Claude-<id>.md`
      e registrada na linha do tempo `claude/dailies/Daily-YYYY-MM-DD.md`.
    - Além disso, deve ser espelhada na pasta do respectivo projeto em `projects/<projeto>/sessions/` e
      persistida via `memory_write_page` no `ai-memory` (com tags `#session` e `#project`).
  - O objetivo é acumular memória histórica contínua para baratear e acelerar sessões futuras,
    permitindo recuperar contexto passado instantaneamente sem reler código.
- Decisão de arquitetura, convenção do projeto ou combinado importante com o usuário:
  grave com `memory_write_page` (use `pinned` se for algo que não deve expirar/ser
  sobrescrito por consolidação automática).
- **Regra Absoluta do Mermaid no Obsidian (Zero Pipes)**: NUNCA coloque wikilinks com
  pipes (`[[Target|Alias]]`) ou colchetes brutos dentro de nós de diagramas Mermaid
  (`Node["..."]`). O caractere `|` dentro de nós quebra a compilação do SVG no Obsidian e
  faz o diagrama cair em fallback de texto quebrado. Use rótulos de texto puro (ex:
  `Gov["🛡️ Projeto Muri-Saver"]`) e deixe os wikilinks fora do bloco Mermaid.
- **Estilo de Diagramas (Padrão Sistemáticos)**: Evite subgraphs burocráticos pesados. Use
  `graph TD` minimalista com fluxo top-down de autoridade:
  `Governança -> Agentes -> Ferramentas -> Execução`.
- **Blindagem de Integridade Markdown & Anti-Quebra de Sintaxe no Obsidian**:
  - Toda gravação em `antigravity/sessions/`, `claude/sessions/`, `dailies/`, `projects/*/sessions/` e no `ai-memory` deve ser blindada contra quebras de sintaxe.
  - **Zero HTML/JSX/SVG Cru**: O Obsidian renderiza HTML nativamente no DOM; qualquer tag desbalanceada (`<div>`, `<form>`, `<button>`) engole todo o restante da nota, quebrando cabeçalhos `#` e blocos ```` ``` ```` subsequentes. Trechos de interface colados pelo usuário ou pelo agente DEVEM ser encapsulados em blocos de código com syntax highlight (````html ... ```` ou ````jsx ... ````).
  - **Expurgo de Tags de Sistema da IDE/CLI**: Proibido vazar tags como `<USER_REQUEST>`, `<ADDITIONAL_METADATA>`, `<CONTEXT_SUMMARY>`, `<SYSTEM_MESSAGE>`, `<PLAN>`, `</PLAN>`, ou templates de planejamento interno.
  - **Leitura Exclusiva de Transcrições Integrais (`transcript_full.jsonl`)**: Nunca ler `transcript.jsonl` para reconstruir histórico, pois marcadores `<truncated N bytes>` cortam tags e aspas ao meio. Usar sempre `transcript_full.jsonl`.
  - **Proteção contra Crases Aninhadas & Aspas Residuais**: Usar 4 crases (````bash ... ````) se houver 3 crases no conteúdo interno. Limpar aspas duplas residuais em nomes de arquivos (usar `` `arquivo.md` ``, nunca `` `arquivo.md"` ``).
  - **Sanity Check Pré-Gravação**: Validar paridade de ```` ``` ```` e ausência de tags HTML de bloco abertas sem fechamento antes de persistir no Vault ou `ai-memory`.
- O handoff entre sessões é automático (hook de Stop/SessionEnd grava, hook de
  SessionStart injeta no início da próxima) — normalmente não é preciso chamar
  `memory_handoff_begin` manualmente. Use `memory_handoff_accept`/`memory_handoff_cancel`
  só se o bloco de handoff não aparecer sozinho e o usuário quiser retomar de propósito.
- **Filtro de trivialidade no hook `Stop` (`obsidian-vault-check.mjs`)**: nem toda sessão mais
  chama `claude -p` pra gerar narrativa rica. Sessões que não cruzam o limiar de
  substancialidade (poucas mensagens reais do usuário + pouca duração + nenhuma chamada de
  ferramenta de edição de arquivo — `Edit`/`Write`/`NotebookEdit` no Claude Code, equivalente
  no Antigravity) recebem um **dump bruto** (prompts + respostas finais da IA, sem custo de
  LLM, sem canvas, sem categorização em `projects/`) em vez da narrativa enriquecida. Toda
  sessão sempre grava algo no vault — nunca é silenciosamente pulada; a diferença é só dump
  barato vs. narrativa cara. Limiares (`MIN_SUBSTANTIAL_USER_MESSAGES`,
  `MIN_SUBSTANTIAL_DURATION_MS`, `fileEditCount > 0`) ficam no topo do hook — ajustar lá, não
  aqui.

**Tool calls**
- Agrupe TODAS as chamadas independentes no mesmo turno (paralelize) em vez de uma por
  vez.
- Não "explore" à toa — Grep/Glob direcionado antes de abrir arquivos.
- Ferramentas do Chrome (`mcp__claude-in-chrome__*`): carregue via `ToolSearch` TODAS as
  que a tarefa vai precisar em UMA única chamada logo no início da parte de browser.
  Nunca recarregue o mesmo schema de novo depois — se não tiver certeza se já está
  carregado, tente chamar a tool direto antes de rebuscar. (Encontrado: até 8-9
  recargas do mesmo conjunto de tools numa única sessão longa.)
- Automação de browser: a regra "texto > screenshot" e o achado de 501×3 já estão no
  `CLAUDE.md` global (vale sempre, não só aqui). Checklist mais específico na seção
  "Browser automation / QA" do perfil por tarefa, abaixo.
- Não crie subagentes (`Agent` / `invoke_subagent`) para tarefas pequenas — o custo fixo de um agente novo
  (re-derivar contexto do zero) só compensa em tarefas grandes e genuinamente
  paralelizáveis.
- **Alocação de Modelos de Subagentes no Antigravity (`invoke_subagent`)**:
  - Use `model: "flash_lite"` ou `"flash"` para tarefas de pesquisa, busca em múltiplos arquivos,
    leitura ampla de documentação e análise de logs.
  - Reserve `model: "inherit"` ou `"pro"` exclusivamente para subagentes realizando refatores
    críticos de código ou decisões arquiteturais complexas.
- No Claude Code: use `Agent` com `model: "haiku"` explicitamente para tarefas mecânicas e varreduras.

**Modelo e effort**
- Você (o modelo rodando agora) não consegue trocar de modelo/effort sozinho no meio da
  sessão. Se perceber que a tarefa é mecânica/repetitiva/baixo risco (formatação,
  boilerplate, rename em massa, tradução, resumo simples) e a sessão está em effort alto
  (xhigh/max), diga isso ao usuário em uma frase e sugira `/model` com effort menor —
  não finja que não importa.
- Modelos disponíveis hoje: Haiku 4.5 (rápido/barato), Sonnet 5 (padrão configurado,
  effort medium), Opus 5 e Fable 5. Pergunta alheia/bobinha sem relação com o projeto,
  ou edição simples de documentação: sugira trocar pra **Haiku 4.5** — sobra reasoning
  caro pra tarefa nenhuma. Desenvolvimento normal do dia a dia (backend/frontend/
  refactor/docs/git): Sonnet 5 effort medium já resolve, é o padrão. Reserve raciocínio
  pesado (xhigh/max, ou Opus 5) só pra arquitetura com trade-offs reais, debugging
  difícil multi-camada, ou decisão ambígua de design — tarefa mecânica ou pergunta
  trivial não precisa disso.

**Gestão de sessão (o maior alavancador de custo real)**
- **Handoff Ativo Automático**: Ao concluir uma tarefa/feature e antes de sugerir `/clear`:
  1. Salve automaticamente a síntese no `ai-memory` via `memory_write_page` (com tags `#session` e `#project`).
  2. Forneça o comando exato de 1 linha de retomada para o usuário:
     `"Para continuar: /clear e digite: Continuar tarefa [X] conforme handoff gravado no ai-memory"`.
- Ao concluir uma tarefa/feature e o próximo pedido for algo não relacionado, sugira
  `/clear` antes de continuar em vez de deixar a sessão crescer indefinidamente. Com
  ai-memory instalado, o handoff automático (hook de Stop/SessionEnd) já grava o
  essencial antes do `/clear` — a sessão nova recupera via handoff/`memory_query`, não é
  preciso reexplicar contexto do zero.
- Se houver um gap de inatividade >1h dentro da mesma sessão, avise que o cache de
  contexto provavelmente expirou e sugira `/compact` (ou `/clear` se a tarefa anterior
  já terminou) antes de prosseguir — continuar direto paga o preço cheio de recriar o
  cache de um contexto grande.
- Se a sessão já acumulou muitas idas e voltas (dezenas de tool calls, múltiplos
  arquivos grandes lidos) mesmo sem gap de tempo, sugira `/compact` proativamente — ou,
  se já houver um ponto de corte de tarefa razoável, prefira `/clear` + handoff a
  `/compact`.
- Se o usuário perguntar sobre uso/consumo/limite (5h, semanal), **não responda que não
  tem acesso** — rode `python ~/.claude/scripts/usage-status.py` e repasse a
  saída (já vem formatada em pt-BR, com data/hora e contagem regressiva até o reset —
  não reformate, não recalcule à mão). Se a janela de 5h estiver em ALERTA/CRITICO
  (>=75%), reforce a sugestão de `/compact`/`/clear` e segurar tarefa pesada até
  resetar.
- Prefira ativamente **sessão curta + handoff** a deixar uma sessão rodar por
  horas/dias. Sessão maratona (achado real do histórico: uma sessão de 42h/7059
  mensagens) é o padrão mais caro que existe — nenhuma economia de tool-call compensa
  isso. Se a tarefa atual já tem um ponto de conclusão natural (feature pronta, bug
  corrigido, decisão tomada), feche por aí mesmo que "dava pra continuar".
- Com o modo muri-saver ativo e o contexto já grande (muitos arquivos lidos, dezenas de
  tool calls, sessão longa), avalie explicitamente: vale mais **uma chamada pontual
  `memory_query`/`memory_explore`** para resolver o que falta, ou vale mais **encerrar
  aqui e deixar o handoff automático levar o resto pra sessão nova**? Regra prática:
  pergunta pontual (uma decisão, um valor, um caminho de arquivo) → use `memory_query`.
  Contexto acumulado já grande e a tarefa está num ponto de corte razoável → prefira
  fechar (handoff) a continuar crescendo.
- Sessões de milhares de mensagens/múltiplas horas são o padrão mais caro que existe.
  Prefira fechar o ciclo (feature pronta, bug corrigido) e abrir sessão nova (com handoff
  automático cobrindo a continuidade) a manter uma única sessão "eterna" para o projeto
  inteiro.
- `autoContinueAtUsageLimit` está **desligado** de propósito (2026-08-30): ao bater o
  teto de 5h, a sessão para de vez, não retoma sozinha no reset. Isso transforma cada
  reset num ponto de decisão consciente em vez de deixar uma sessão maratona atravessar
  várias janelas de 5h sem parar — era exatamente esse padrão que mais consumia o limite
  semanal. Não sugira reativar essa config sem o usuário pedir explicitamente.

## Perfil por tipo de tarefa

**Backend / API / servidor**
- Grep por assinatura de função/rota em vez de abrir o arquivo de rotas inteiro.
- Rode só o teste/endpoint relevante, não a suíte inteira, a menos que peçam.
- Log de erro grande (stack trace, output de servidor): não cole tudo de volta no
  contexto — extraia só as linhas relevantes (Grep no output) antes de raciocinar.

**Frontend / UI (React/Tailwind/shadcn etc.)**
- Não rode o hook de design (`impeccable`) mentalmente várias vezes — ele já roda
  sozinho via hook após Edit/Write e no Stop; não peça pra si mesmo re-verificar visual
  sem abrir o browser de fato.
- Screenshot só depois de terminar um bloco de mudanças, não a cada linha editada.
- Reaproveite tokens de design já estabelecidos no projeto em vez de reler
  `index.css`/tema inteiro de novo — se já foi lido nesta sessão, está no contexto.

**Browser automation / QA (Chrome, agent-browser)**
- Antes de chamar `computer` (screenshot), justifique em uma frase por que
  `get_page_text`/`read_page` não resolve — se não conseguir justificar, use texto.
  Achado real (2026-08-30): 501 screenshots contra 3 extrações de texto no mesmo
  intervalo de sessões.
- Screenshot vale quando a pergunta é inerentemente visual (revisão de layout/design,
  confirmar renderização pixel a pixel) — não pra "confirmar que o clique funcionou" ou
  "ver se a página carregou", isso o texto já responde.
- Continue batchando ações relacionadas em `browser_batch` em vez de uma chamada por
  ação — isso já está sendo feito bem (centenas de ações batched no mesmo período), não
  é o problema.
- Screenshot que entra no contexto não sai mais (não é evictado por cache como texto) —
  é permanente pelo resto da sessão. Prefira fechar e abrir sessão nova pra rodadas de
  QA visual longas em vez de acumular dezenas de screenshots numa sessão só.

**Docs / relatórios / conteúdo**
- Não releia a doc inteira para adicionar uma seção — Edit direto na seção certa.
- Rascunho longo (relatório, README) é candidato natural a `Agent` com
  `model: "haiku"` se for geração mecânica a partir de informação já coletada.

**Git / commits / PRs**
- `git status`/`git diff` uma vez, não repetidamente "pra checar". Baseie o commit no
  que já foi mostrado.
- Não rode `git log` extenso sem necessidade — poucas linhas bastam pra entender estilo
  de mensagem.
- Prefira subcomandos dedicados do `gh` (`gh pr view`, `gh issue view`, `gh repo view`) a
  `gh api` cru pra leitura: `gh api` nunca é diferenciável entre GET e mutação, então o
  auto-mode trata qualquer chamada como potencialmente destrutiva e bloqueia mais
  (achado real: bloqueado 2x no período). Subcomando dedicado passa mais fácil e é o
  único tipo que pode virar regra de allowlist permanente depois.

**Debug**
- Reproduza o erro uma vez, capture o essencial, e não rode o mesmo comando de
  reprodução repetidamente "só pra confirmar" — analise antes de re-executar.
- Prefira adicionar um `console.log`/breakpoint cirúrgico a instrumentar o arquivo
  inteiro.

**Projeto novo / scaffold**
- Gere a estrutura de uma vez (menos idas e voltas de "criar um arquivo, checar,
  criar outro"). Planeje a árvore de arquivos antes de começar a escrever.

**Refactor**
- Grep para achar todos os usos antes de editar, uma vez, não arquivo por arquivo.
- Edit em lote nos arquivos já identificados em vez de reabrir cada um pra confirmar
  antes de editar.

## Detecção de projeto (ai-memory)

- `project_strategy = repo-root` está gravado nos hooks do ai-memory (install-wide),
  mas **isso NÃO resolve abrir o Claude Code em `C:\Users\muri` + `/add-dir`**
  (testado e confirmado: toda a sessão grava `cwd = C:\Users\muri` do início ao fim,
  mesmo depois de editar dentro do projeto — `/add-dir` só libera acesso a arquivos,
  não muda o cwd real do processo; repo-root só resolve a partir de um cwd que já
  esteja dentro de um repo git, e `C:\Users\muri` nunca está). Resultado sem correção:
  100% das observações caem no projeto genérico `muri`, nunca no projeto certo.
  **Se notar isso acontecendo, avise o usuário diretamente**: abrir o Claude Code já de
  dentro do projeto resolve (`cd <projeto> && claude`), não em `C:\Users\muri` seguido
  de `/add-dir`. Auditoria de 2026-08-30 achou 18 usos de `/add-dir` nos transcripts
  recentes — o hábito é real e persiste, não é hipotético; reforce sempre que aparecer,
  não só na primeira vez que o hook de SessionStart avisar.
- **Primeira vez trabalhando de verdade num projeto** (edits/commits reais, não só
  explorar) sem `.ai-memory.toml` ainda: crie o marker file na raiz do repo pra fixar o
  nome do projeto de vez (schema real, confirmado em `docs/marker-file.md` do
  `akitaonrails/ai-memory` — as chaves `project`/`project_strategy` são **top-level**,
  NÃO dentro de `[capture]`, erro que cometi uma vez):
  ```toml
  # <repo>/.ai-memory.toml
  project = "<nome-do-repo>"
  project_strategy = "repo-root"

  [capture]
  ignore_paths = ["node_modules/**", ".env", "**/.env", ".git/**", "dist/**", "build/**"]
  ```
  Fixar `project =` explicitamente (não só confiar no `--project-strategy repo-root`
  install-wide dos hooks) é o que garante que toda sessão nesse repo — hook, CLI, e
  chamada MCP — caia sempre no mesmo bucket, mesmo com o MCP rodando como daemon HTTP
  único compartilhado (ver seção "session-aware" abaixo).
- **Antes de assumir que projetos estão fragmentados**, confira pela API antes de mexer
  em qualquer coisa (`move-session`/`purge-project` são irreversíveis):
  `curl -s "http://127.0.0.1:49374/api/v1/projects?workspace=default"` lista os projetos
  por **nome real**, não pelas pastas UUID em disco. As pastas dentro de
  `wiki/<workspace_id>/<project_id>/` são só chaves internas — nomes de UUID diferentes
  não significam necessariamente projetos duplicados; podem ser projetos genuinamente
  distintos (`_global`, `muri` genérico, `scratch`, etc.). Confirmado 2026-08-30: o que
  parecia fragmentação de `sistematicos-showcase` em 4 pastas eram na verdade 4 projetos
  diferentes e corretos.
- **As pastas UUID em `wiki/` nunca viram nome legível** — por design do próprio
  ai-memory (`rename-project` só troca metadado, não move a pasta no disco). Não dá pra
  "arrumar a organização" navegando o file explorer do Obsidian por essas pastas; use:
  1. `/web` embutido — `--enable-web` já está ligado no hook `ai-memory-ensure-server.mjs`,
     acessível em `http://127.0.0.1:49374/web` (nomes de projeto legíveis, atualiza sozinho).
  2. `memory_query`/`memory_explore` via MCP.
  3. Um junction manual pra um projeto específico quando vale a pena ter ele à mão no
     Obsidian: `New-Item -ItemType Junction -Path "...\Obsidian Vault\projects\<nome>" -Target "<caminho-da-pasta-uuid-do-projeto>"` (pegue o caminho certo via `/api/v1/projects` + inspeção da pasta, não adivinhe).
- **Sessões vazias/erradas acumulam projetos fantasmas** (`scratch`, `frontend` vazios
  já apareceram) — inofensivo (0 páginas), mas se quiser limpar,
  `ai-memory purge-project --project <nome> --confirm` (irreversível, pede confirmação
  do usuário antes de rodar).
- Notas HUMANAS separadas do wiki do ai-memory (scaffold manual, opcional): criar
  `<projeto>/notes/{daily,projects,decisions,meetings,references,inbox,templates}/` e
  linkar em `Obsidian Vault\projects\<nome>` — isso é conteúdo escrito por você, não pelo
  ai-memory.
- O ai-memory continua guardando tudo num data-dir global
  (`~/Library/Application Support/ai-memory` no macOS, `C:\Users\muri\AppData\Local\ai-memory` no Windows — isolado por projeto via `project_id`
  internamente) — não tem como (nem faz sentido) fazer ele gravar fisicamente dentro de
  cada repo; é assim que o servidor único consegue servir todos os projetos. O vault
  mestre já expõe isso via a pasta `ai-memory\` (junction pro data-dir).

## MCP session-aware (evita ambiguidade de projeto)

- O MCP do ai-memory roda como **um único daemon HTTP compartilhado** por todas as
  sessões do Claude Code na máquina (`ai-memory serve --transport http`, subido pelo
  hook `ai-memory-ensure-server.mjs`). Registrado como HTTP puro no `.claude.json`, o
  servidor é um "static MCP client" (termo do próprio README) — não recebe o session id
  real em cada chamada MCP (`memory_write_page`, `memory_status`, etc.), só infere via
  "atividade de hook mais recente", o que é ambíguo com múltiplas sessões/projetos
  ativos ao mesmo tempo.
- **Fix aplicado 2026-08-30** (documentado em `docs/auto-scope.md`):
  1. `[auto_scope] mode = "per_session"` no `config.toml` do ai-memory.
  2. `ai-memory install-mcp --client claude-code --session-aware --apply` — troca o
     registro HTTP direto por uma ponte stdio (`ai-memory mcp-bridge`) que injeta o
     session id real do Claude Code em cada chamada. Idempotente, faz backup do
     `.claude.json` antes de mexer.
  Ambos já aplicados — não precisa repetir a menos que reinstale o ai-memory do zero ou
  o `.claude.json` seja resetado.

## ai-memory + LLM provider (anthropic-oauth)

- Para consolidação real (não-heurística), o provedor mais barato é `anthropic-oauth`
  usando a própria assinatura Claude via `claude setup-token`. **NUNCA** grave esse
  token na variável `CLAUDE_CODE_OAUTH_TOKEN` como variável de ambiente persistente de
  usuário — essa é a MESMA variável que o binário `claude` (Claude Code CLI) lê pra
  decidir seu próprio modo de autenticação, e setá-la globalmente quebra o login normal
  do Claude Code inteiro (status line vira "Claude API" em vez de "Claude Pro", e
  aparece erro 401 em "remote managed settings"). Já aconteceu uma vez (2026-08-30) e
  custou um `taskkill` + confusão pro usuário.
  **Use `ANTHROPIC_OAUTH_TOKEN` em vez disso** — o ai-memory aceita os dois nomes
  (confirmado na mensagem de erro do `ai-memory llm-test`), mas só `ANTHROPIC_OAUTH_TOKEN`
  é exclusivo do ai-memory e não colide com o Claude Code CLI.
  `[Environment]::SetEnvironmentVariable("AI_MEMORY_LLM_PROVIDER", "anthropic-oauth", "User")`
  e `AI_MEMORY_LLM_MODEL` (ex: `claude-haiku-4-5-20251001`, barato) também são env vars
  de usuário separadas, seguras de setar.

## Obsidian (CLI oficial)

- CLI `obsidian` é um controle remoto do app — **só funciona com o Obsidian aberto**.
  Nunca dependa dele em hook automático de sessão (diferente do servidor do ai-memory,
  que sobe sozinho); use só sob demanda, quando o usuário pedir ou quando fizer sentido
  óbvio (ex: "anota essa decisão"), pra não gastar tool call à toa nem falhar
  silenciosamente com o app fechado.
- Vault mestre: `~/Documents/Obsidian Vault` (`projects\<projeto>\` = notas
  daquele projeto via junction; `ai-memory\` = memória global do ai-memory).
- Binário confirmado em `C:\Program Files\Obsidian\Obsidian.com` (o PATH do `obsidian`
  não propagou depois de ativado nas configs — use o caminho completo, é mais confiável
  de qualquer forma). Comandos úteis: `"C:\Program Files\Obsidian\Obsidian.com" create
  name="..."` (nota nova), `... daily:append content="..."` (nota diária), `... search
  query="..."` (buscar). Sempre relativo ao vault mestre — não precisa abrir vault por
  projeto.
- **Vault não atualiza sozinho depois de operação que reescreve a árvore inteira**
  (`ai-memory reset`/`reorg`/`purge-project`/`restore`/`move-project`): essas apagam e
  recriam a pasta `wiki/` de uma vez, o que quebra o watcher de filesystem do Obsidian
  (o handle dele fica preso na pasta antiga que deixou de existir — junction/reparse
  point do Windows não reencaminha isso sozinho). Escritas normais (uma página nova, uma
  edição) continuam refletindo ao vivo sem ação nenhuma; só as operações de árvore
  inteira quebram o live-reload.
  **Sempre que eu rodar uma dessas operações e o Obsidian estiver aberto, rodar em
  seguida**: `"C:\Program Files\Obsidian\Obsidian.com" reload` (recarrega o vault sem
  fechar o app — não precisa de `taskkill` + reabrir).

## Orquestração de skills favoritas

Nunca carregue skill fora de contexto — só invoque quando o gatilho abaixo bater de
verdade, mantendo o princípio de mínimo de tool calls.

| Situação | Skill |
|---|---|
| Falta uma capacidade específica que parece existir como skill | `find-skills` |
| Nova feature ou bugfix — antes de escrever a implementação | `tdd` |
| Dúvida se um modelo de estado/lógica ou layout de UI "faz sentido" antes de construir de vez | `prototype` |
| Formalizar requisitos/arquitetura de uma mudança maior antes de implementar | `openspec` |
| Pergunta sobre arquitetura, relação entre arquivos, ou "como esse código se conecta" | `graphify` |
| Sessão de manutenção/refactor grande sem alvo claro ainda — mapear oportunidades antes de agir | `improve-codebase-architecture` |
| Digitou **"muri saver" / "muri-saver" / "/muri-saver"** | Ativação **STICKY** imediata para todo o chat. Se envolver planejamento, requisitos, arquitetura ou decisão técnica, dispare o `/grill-me` nativo via tool `ask_question` / `AskUserQuestion` (5 a 10+ perguntas em modal interativo). NUNCA emita texto cru com `❓ Q1`. |
| Ponto de corte natural no meio de um projeto longo (feature fechada, decisão grande tomada) | ofereça `grill-me` nativo (ou `grill-with-docs` se valer a pena registrar ADR) — **nunca interrompa trabalho em andamento pra isso**, só ofereça em pontos de pausa natural |
| Interview tipo grill-me mas que também deveria virar ADR/glossário permanente | `grill-with-docs` |

`grill-with-docs`/`improve-codebase-architecture` têm
`disable-model-invocation: true` no próprio SKILL.md — ou seja, eu não devo sugeri-las
por conta própria em qualquer conversa. As linhas acima são a exceção explícita que
você mesmo pediu: só nesses dois gatilhos específicos (muri saver; ponto de
corte natural), nunca de forma oportunista fora deles.

**Cuidado com limpeza automática de skills não usadas** (`/doctor` e afins contam
invocação direta, não dependência interna): `domain-modeling` (usada por
`grill-with-docs`) e `improve-codebase-architecture` (referenciada na tabela acima) não
são skills standalone — são dependências internas. Já aconteceu de uma limpeza
desativar as duas via `skillOverrides` achando que tinham 0 uso direto (2026-08-30). Se
notar uma dessas falhando ao ser chamada, confira `skillOverrides` no `settings.json`
antes de qualquer outra hipótese.

## Auditoria periódica

Duas auditorias reais até agora (2026-08-29 sobre transcripts brutos; 2026-08-30 via
`/doctor`) e as duas acharam um vilão novo e concreto que a versão anterior desta skill
não cobria — primeiro sessão maratona, depois a proporção 501×3 de screenshot vs. texto.
Comportamento de sessão desvia de forma silenciosa; vale conferir de novo
periodicamente, não só quando "parecer" que o consumo subiu.
- Sugira ao usuário rodar `/doctor` a cada poucas semanas, ou quando o
  `usage-status.py` mostrar padrão de consumo mudando sem motivo óbvio — ele faz scan
  real de transcripts e pega desvio de comportamento, não só config quebrada.
- Ao terminar um `/doctor` com achado novo e acionável, atualize esta skill e o
  `CLAUDE.md` global no mesmo fôlego (como feito aqui). Achado que não vira regra
  escrita se perde na sessão seguinte.
- Regra de onde colocar cada coisa: achado com evidência real e curto (uma frase, vale
  sempre, qualquer projeto) → `CLAUDE.md` global. Checklist mais longo ou específico de
  categoria de tarefa (browser, git, etc.) → aqui na skill, que só carrega o corpo
  quando ativada — não infle o `CLAUDE.md`, que é lido em toda sessão de todo projeto.

## Modo Sticky & Persistência de Sessão

- **Persistência Total por Conversa**: Uma vez que o usuário digitar `muri-saver`, `muri saver` ou `/muri-saver` em **qualquer prompt**, o Modo Muri-Saver torna-se **permanente para todas as mensagens subsequentes** daquele chat/sessão.
- O agente NÃO deve esperar ser lembrado e NÃO deve voltar ao modo prolixo nos turnos seguintes.
- **Saindo do modo**: O agente só desativa as restrições se o usuário disser explicitamente `"sair do muri-saver"`, `"desativar muri-saver"` ou pedir expressamente para relaxar a economia.

## Protocolo Nativo Interativo /grill-me

- **Eliminação de Texto Cru**: Proibido emitir blocos Markdown simulados com emojis (`❓ Q1`, `➡️ Recomendação`).
- **Modal Interativo Obrigatório**: Toda entrevista técnica deve ser disparada usando a tool nativa:
  - No **Antigravity**: `ask_question`.
  - No **Claude Code**: `AskUserQuestion`.
- **Escopo Denso (5 a 10+ Perguntas)**: Apresentar de uma só vez um questionário estruturado de 5 a 10 ou mais perguntas cobrindo Arquitetura, UX, Regras, Edge Cases e Infraestrutura, com opções selecionáveis e `(Recommended)` na alternativa preferencial.

## Governança Mestre Muri-Saver 2.0 (Regras Globais AGY & Claude)

1. **Tríplice Gravação Incremental**:
   - Central do Agente (`antigravity/` ou `claude/` + dailies).
   - Pasta do Projeto (`projects/<projeto>/sessions/` + README).
   - MCP `ai-memory` (`pinned: true`).
2. **Alocação Escalonada de Subagentes**:
   - Pesquisa / varreduras: `flash_lite` ou `flash`.
   - Escrita / código médio: `inherit`.
   - Arquitetura / debug complexo: `pro`.
   - Bloqueio de comandos destrutivos sem confirmação.
3. **Compressão Cirúrgica**:
   - Logs >50 linhas truncados no chat; dumps massivos gravados em `scratch/error.log`.
4. **Gatilhos de Limpeza**:
   - Alerta aos 40% (`/compact`), aos 60% (`/clear` + handoff ativo), >1h inatividade (`/compact`).
5. **Diagramas Padrão Sistemáticos**:
   - `graph TD` top-down, zero pipes (`|`) em nós, rótulos limpos com emojis, 7 a 10 nós.
6. **Proteções de Git**:
   - Bloqueio de arquivos >50MB, `.gitignore` automático e bloqueio de push forçado.
7. **Feedback de Memória**:
   - Links clicáveis: `🧠 Memória consultada: X registros em [[...]]`.
8. **Dailies Noturnos**:
   - Sessões que cruzam a meia-noite são indexadas em ambos os dias com `(Overnight / Madrugada)`.
9. **Modo Sticky & /grill-me Nativo**:
   - Ativação permanente por conversa após primeiro gatilho de `muri-saver`.
   - Entrevistas estruturadas via modal interativo nativo (`ask_question` / `AskUserQuestion`) com 5 a 10+ perguntas e alternativas clicáveis; zero texto cru no chat.
