# Alterna o provedor LLM da consolidação do ai-memory (documentação/markdown do vault).
#
#   .\ai-memory-llm-mode.ps1 economico   -> Gemini (gratis, nao conta no limite 5h/7d do Claude Code) [padrao]
#   .\ai-memory-llm-mode.ps1 premium     -> Claude via token OAuth de longa duracao (melhor qualidade,
#                                           CONSOME do limite 5h/7d do Claude Code)
#
# So muda variaveis de ambiente do usuario (User scope) + reinicia o servidor compartilhado do
# ai-memory (afeta todas as sessoes abertas nesta maquina; elas reconectam sozinhas).

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("premium", "economico")]
    [string]$Modo
)

if ($Modo -eq "premium") {
    $provider = "anthropic-oauth"
    $model = "claude-sonnet-4-6"
    Write-Output "Modo PREMIUM: ai-memory vai consolidar com Claude ($model) via token OAuth."
    Write-Output "Isso consome do seu limite de 5h/7 dias do Claude Code."
} else {
    $provider = "gemini"
    $model = "gemini-flash-latest"
    # Alias que a Google mantem apontando pro modelo flash atual mais disponivel
    # (hoje resolve pra familia 3.x) -- evita ficar preso num modelo antigo/
    # sobrecarregado feito gemini-2.5-flash. Confirmado 2026-08-30: a mesma
    # GEMINI_API_KEY ja tem acesso a gemini-3.5/3.6/3.7-flash e gemini-3.1-pro-preview.
    Write-Output "Modo ECONOMICO: ai-memory vai consolidar com Gemini ($model), sem custo extra."
}

[Environment]::SetEnvironmentVariable("AI_MEMORY_LLM_PROVIDER", $provider, "User")
[Environment]::SetEnvironmentVariable("AI_MEMORY_LLM_MODEL", $model, "User")
# Tambem no processo atual, para o restart abaixo ja nascer com o valor novo
# (SetEnvironmentVariable com escopo User so afeta processos futuros).
$env:AI_MEMORY_LLM_PROVIDER = $provider
$env:AI_MEMORY_LLM_MODEL = $model

$listener = Get-NetTCPConnection -LocalPort 49374 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    Stop-Process -Id $listener.OwningProcess -Force
    Start-Sleep -Seconds 1
}
node "$env:USERPROFILE\.claude\hooks\ai-memory-ensure-server.mjs" | Out-Null
Start-Sleep -Seconds 2
Write-Output "Servidor ai-memory reiniciado nesse modo."
