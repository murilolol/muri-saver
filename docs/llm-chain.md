# Cadeia de LLMs

Duas coisas do muri-saver precisam de um modelo de linguagem, e nenhuma delas
deveria gastar a cota do seu agente principal:

| Quem usa | Para quê | Cadeia |
|---|---|---|
| Hook do vault (worker) | Narrativa das notas de sessão no Obsidian | `llm.narrative` |
| ai-memory, via shim | Consolidar sessões em páginas da wiki (auto-improve) | `llm.aiMemory` |

Uma **cadeia** é uma lista ordenada de modelos. O primeiro que responder
vence. Erro de cota, 5xx, timeout, resposta vazia ou JSON inválido passam para
o próximo, e o modelo que falhou por limite fica em **cooldown** pelo tempo que
o erro indicar. Os dois clientes compartilham o mesmo arquivo de cooldown, então
um respeita o limite que o outro descobriu.

## Formato das entradas

`<tipo>:<modelo>[@<timeout em segundos>]`

| Tipo | Usa | Cota | Precisa de |
|---|---|---|---|
| `gemini-api` | API do Gemini | grátis, **separada por modelo** (zera à meia-noite do Pacífico) | `GEMINI_API_KEY` |
| `agy` | Antigravity CLI (`agy`) | plano Google (janela de 5h + semanal) | `agy` instalado e logado |
| `claude` | Claude Code headless (`claude -p`) | **a do seu plano Claude** | `claude` instalado |
| `openai` | qualquer endpoint OpenAI-compatível (Ollama, LM Studio, OpenRouter, Groq...) | a do provedor | `llm.openai.baseUrl` |

Entrada indisponível (sem chave, CLI ausente) é pulada sem cooldown. Modelo que
sumiu do provedor devolve 404 e fica 24h fora, então um id antigo degrada para
o próximo da lista em vez de quebrar.

### Padrões

```json
{
  "llm": {
    "narrative": ["agy:gemini-3.1-pro-high", "agy:gemini-3.8-flash-high", "gemini-api:gemini-2.5-flash"],
    "aiMemory": [
      "gemini-api:gemini-3.1-pro-preview", "gemini-api:gemini-3.8-flash", "gemini-api:gemini-2.5-flash",
      "agy:gemini-3.1-pro-high", "agy:gemini-3.8-flash-high"
    ]
  }
}
```

A cadeia do ai-memory começa pela API key de propósito: a cota grátis é por
modelo, então vários modelos em sequência rendem bem mais que um só. Quando ela
acaba, o `agy` assume (cota do plano Google). A narrativa vai direto pro `agy`
Pro, que escreve melhor.

Nenhum padrão usa `claude:` — quem quiser gastar a cota do Claude nisso coloca
explicitamente.

## Configurando

No `~/.claude/muri-saver.json` (o `--update` preserva o que você editar):

```json
{
  "llm": {
    "narrative": ["openai:llama3.1:8b", "gemini-api:gemini-2.5-flash"],
    "aiMemory": ["gemini-api:gemini-2.5-flash"],
    "apiKeyFile": "~/.config/muri-saver/llm.env",
    "openai": { "baseUrl": "http://127.0.0.1:11434/v1", "apiKeyEnv": "OPENROUTER_API_KEY" },
    "shimPort": 49380
  },
  "narrative": { "intervalMinutes": 15, "maxChars": 200000, "bridgeToAiMemory": ["antigravity"] },
  "language": "pt-BR"
}
```

Ou pelo instalador:

```bash
node bin/install.mjs --update --narrative-chain "agy:gemini-3.1-pro-high,gemini-api:gemini-2.5-flash"
node bin/install.mjs --update --narrative-chain off      # vault só com o dump local
node bin/install.mjs --update --llm-key-file ~/.config/muri-saver/llm.env
```

Variáveis de ambiente ganham da config (úteis pra testar):
`MURI_SAVER_NARRATIVE_CHAIN`, `MURI_SAVER_AIM_CHAIN`, `MURI_SAVER_BACKFILL_CHAIN`
(lista separada por vírgula, ou `off`).

### Chave da API

O muri-saver **nunca grava a chave**. Ele lê `GEMINI_API_KEY` (ou
`GOOGLE_API_KEY`) do ambiente e, se `llm.apiKeyFile` estiver definido, de um
arquivo `KEY=valor` (aceita `export KEY=...`, então pode ser o seu `~/.zprofile`
ou `~/.bashrc`). Isso existe porque launchd, systemd e o Agendador de Tarefas
não leem o perfil do shell: sem o arquivo, o shim rodando como serviço não veria
a chave.

## O shim do ai-memory

O ai-memory não tem provedor por CLI e a cadeia de fallback nativa dele não trata
JSON cortado nem cota diária por modelo. O `scripts/ai-memory-llm-shim.mjs` é um
servidor OpenAI-compatível local (`127.0.0.1:49380`) que o ai-memory usa como
provedor `openai-compat`, e que por dentro percorre a cadeia `llm.aiMemory`.

```bash
muri-saver llm chain      # aponta o ai-memory pro shim e reinicia o servidor
muri-saver llm status     # provedor ativo + estado de cada modelo da cadeia
muri-saver llm tune       # limites recomendados (ver abaixo)
muri-saver llm gemini     # sem shim: Gemini 2.5 Flash direto pela API key
muri-saver llm anthropic  # Claude via ANTHROPIC_OAUTH_TOKEN (gasta a cota do Claude)
muri-saver llm off        # sem LLM: só captura, nada vira página
```

(`muri-saver <cmd>` = `npx muri-saver <cmd>` ou `node ~/.claude/scripts/ai-memory-llm-mode.mjs <cmd>`.)

`llm chain` também grava `llm.shim: true` no `muri-saver.json`. A partir daí, o
hook SessionStart sobe o shim se ele estiver fora do ar, em qualquer SO. Para ele
ficar de pé mesmo sem abrir um agente, registre o serviço:
`muri-saver jobs install llm-shim`.

- Saúde: `curl -s http://127.0.0.1:49380/health` (cada modelo: `available`,
  `installed`, `cooling_until`).
- Log: `~/.claude/hooks/.ai-memory-llm-shim.log` (uma linha por chamada: modelo,
  segundos, tamanho de entrada/saída, o que foi tentado antes).

### Limites recomendados (`muri-saver llm tune`)

Os limites decidem quanto de cada sessão vira memória, mais que o modelo:

| Chave do `config.toml` | Padrão do ai-memory | Recomendado | Por quê |
|---|---|---|---|
| `llm_timeout_secs` | — | 900 | `agy` com Pro pode levar minutos; o shim desiste em 14 min |
| `[consolidation] max_input_tokens` | 100000 | 300000 | sessões longas cabiam pela metade |
| `[consolidation] max_output_tokens` | 32000 | 64000 | páginas grandes saíam cortadas |
| `[auto_improve] max_input_tokens` | 24000 | 150000 | o revisor via ~5% das observações de uma sessão longa |
| `[auto_improve] max_proposals_per_run` | 5 | 12 | |
| `[auto_improve] min_confidence` | 0.75 | 0.6 | |
| `[auto_improve] min_observations` | 8 | 5 | |
| `[auto_improve] min_session_duration_secs` | 120 | 60 | |
| `[auto_improve.scheduler] interval_secs` / `max_sessions_per_tick` | 60 / 10 | 300 / 2 | rajada de backlog estourava a cota grátis em minutos |

`tune --dry-run` mostra sem gravar. Sempre fica um backup `config.toml.bak-tune`.

## Sessões que ficaram para trás

Quando toda a cadeia está em cooldown, o scheduler do ai-memory **estaciona** a
sessão (`parked=true`) e não tenta de novo. O job `reprocess-parked` (ver
[background-jobs.md](./background-jobs.md)) monta a fila a partir dos logs do
ai-memory e reprocessa uma por vez, só quando a cadeia tem modelo livre.
