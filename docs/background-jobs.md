# Jobs de fundo

Alguns trabalhos não cabem num hook: rodam de hora em hora, esperam uma cota
resetar ou ficam de pé como serviço. O `scripts/muri-jobs.mjs` registra cada um
no agendador nativo do sistema:

| SO | Onde | Como desfazer à mão |
|---|---|---|
| macOS | LaunchAgent `~/Library/LaunchAgents/com.muri-saver.<job>.plist` | `launchctl bootout gui/$(id -u)/com.muri-saver.<job>` |
| Linux | `systemd --user` (`muri-saver-<job>.service` + `.timer` em `~/.config/systemd/user/`); sem systemd, `crontab` com a marca `# muri-saver:<job>` | `systemctl --user disable --now muri-saver-<job>.timer` |
| Windows | Agendador de Tarefas, pasta `\muri-saver\` | `schtasks /Delete /TN "\muri-saver\<job>" /F` |

## Os jobs

| Job | Quando | O que faz | Para sozinho? |
|---|---|---|---|
| `llm-shim` | serviço (reinicia se cair) | Shim OpenAI-compatível da cadeia de LLMs do ai-memory ([llm-chain.md](./llm-chain.md)) | não |
| `finalize-idle` | a cada 60 min | Encerra no ai-memory as sessões abertas e ociosas há mais de 2h. O Antigravity não tem SessionEnd e o auto-improve só consolida sessão encerrada: sem isto, nada do Antigravity vira memória | não |
| `reprocess-parked` | toda hora, no minuto 10 | Reprocessa as sessões que o ai-memory estacionou quando a cota acabou. O minuto 10 pega o reset diário da API do Gemini logo depois que acontece | **sim**, quando a fila zera |
| `vault-backfill` | a cada 2h | Gera narrativa para notas do vault que ficaram só com o dump (últimos 14 dias por padrão) | **sim**, quando a fila zera |
| `quota-snapshot` | a cada 60 min | Guarda a cota atual do Claude num histórico (`.quota-history.jsonl`) | não |
| `economy-report` | segunda, 09:00 | Relatório semanal de economia salvo no vault ([economy-report.md](./economy-report.md)) | não |

Os dois últimos são Python; precisam de `python3` (ou `python`/`py` no Windows)
no PATH. Os outros só de Node.

## Instalando

```bash
node bin/install.mjs --update --with-jobs            # os recomendados*
node bin/install.mjs --update --jobs finalize-idle,reprocess-parked
node bin/install.mjs --update --jobs all
node bin/install.mjs --update --no-jobs              # remove todos

muri-saver jobs list                  # o que existe
muri-saver jobs status                # o que está registrado e ativo
muri-saver jobs install llm-shim      # registra um job avulso
muri-saver jobs run reprocess-parked  # roda agora, em primeiro plano
```

\* Recomendados: `finalize-idle`, `reprocess-parked`, `quota-snapshot`,
`economy-report`, mais `vault-backfill` se houver vault e `llm-shim` se
`llm.shim` estiver ligado.

Os jobs ficam listados em `jobs` no `muri-saver.json`, então o `--update` os
re-registra (útil depois de trocar de versão do Node) e o `--uninstall` os remove.
Cada job roda o script **instalado** em `~/.claude/scripts/`, nunca o do clone.

## Como "esperar a cota resetar" sem desperdiçar nada

`reprocess-parked` e `vault-backfill` podem rodar toda hora porque não gastam
nada quando não há o que fazer:

1. Antes de começar, o reprocessador pergunta ao shim (`/health`) se algum
   modelo da cadeia está livre. Se não, sai com código 75 na hora.
2. Se a cota acaba no meio, a sessão atual **fica na fila** (não vai para a lista
   de falhas) e a próxima rodada continua dela.
3. Falha da própria sessão (não de cota) vai para a lista de falhas. Quando a
   fila principal zera, as falhas ganham **uma** segunda passada.
4. Três falhas seguidas parecem problema geral (servidor fora, binário quebrado):
   ele para em vez de esvaziar a fila na lista de falhas.
5. Fila zerada de vez: o job se desativa (`launchctl bootout` + o plist vira
   `.disabled`, `systemctl --user disable`, `schtasks /DISABLE` ou a linha some do
   crontab). Não volta nem depois de reiniciar a máquina.

Uma trava (`.ai-memory-reprocess.pid`) impede duas instâncias ao mesmo tempo, por
exemplo o job e uma execução manual.

## Logs

Tudo em `~/.claude/hooks/`:

| Arquivo | De quem |
|---|---|
| `.job-<job>.log` | saída bruta do agendador (stdout/stderr) |
| `.ai-memory-finalize-idle.log` | sessões encerradas por rodada |
| `.ai-memory-reprocess.log` | uma linha por sessão (`ok`, `falha`, `cadeia esgotada`) |
| `.vault-backfill.log` | uma linha por nota |
| `.ai-memory-llm-shim.log` | uma linha por chamada ao modelo |

## Limitações conhecidas

- **Windows**: a tarefa roda `node.exe` direto, então uma janela de console pode
  piscar a cada execução. A geração do XML é coberta por teste; o registro real
  no Agendador ainda não foi exercitado numa máquina Windows de verdade.
- **Linux sem systemd** (WSL antigo, containers): cai no `crontab`. O `llm-shim`
  vira uma linha `@reboot`, e o hook SessionStart sobe o shim se ele cair.
- Os horários seguem o relógio local da máquina.
