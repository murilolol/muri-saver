#!/usr/bin/env bash
# Alterna o provedor LLM da consolidação do ai-memory (documentação/markdown do vault).
# Equivalente macOS do ai-memory-llm-mode.ps1 (Windows).
#
#   ./ai-memory-llm-mode.sh economico   -> Gemini (gratis, nao conta no limite 5h/7d do Claude Code) [padrao]
#   ./ai-memory-llm-mode.sh premium     -> Claude via token OAuth de longa duracao (melhor qualidade,
#                                          CONSOME do limite 5h/7d do Claude Code)
#
# No Windows a persistencia usa [Environment]::SetEnvironmentVariable(...,"User") (registro).
# No macOS nao existe equivalente direto: persiste via arquivo de env sourced pelo ~/.zshrc,
# e reinicia o servidor compartilhado do ai-memory nesta maquina (afeta todas as sessoes
# abertas; elas reconectam sozinhas).

set -euo pipefail

MODO="${1:-}"
if [[ "$MODO" != "premium" && "$MODO" != "economico" ]]; then
  echo "Uso: $0 premium|economico" >&2
  exit 1
fi

if [[ "$MODO" == "premium" ]]; then
  PROVIDER="anthropic-oauth"
  MODEL="claude-sonnet-4-6"
  echo "Modo PREMIUM: ai-memory vai consolidar com Claude ($MODEL) via token OAuth."
  echo "Isso consome do seu limite de 5h/7 dias do Claude Code."
else
  PROVIDER="gemini"
  MODEL="gemini-flash-latest"
  # Alias que a Google mantem apontando pro modelo flash atual mais disponivel,
  # mesmo criterio usado na versao Windows.
  echo "Modo ECONOMICO: ai-memory vai consolidar com Gemini ($MODEL), sem custo extra."
fi

ENV_DIR="$HOME/Library/Application Support/ai-memory"
ENV_FILE="$ENV_DIR/llm-mode.env"
mkdir -p "$ENV_DIR"
cat > "$ENV_FILE" <<EOF
export AI_MEMORY_LLM_PROVIDER="$PROVIDER"
export AI_MEMORY_LLM_MODEL="$MODEL"
EOF

RC_FILE="$HOME/.zshrc"
if [[ -f "$RC_FILE" ]] && ! grep -qF "$ENV_FILE" "$RC_FILE"; then
  {
    echo ""
    echo "# ai-memory: modo de LLM da consolidação (alternado via ai-memory-llm-mode.sh)"
    echo "[ -f \"$ENV_FILE\" ] && source \"$ENV_FILE\""
  } >> "$RC_FILE"
fi

# Exporta no processo atual tambem, para o restart abaixo ja nascer com o valor novo
# (novos terminais pegam via ~/.zshrc; esta sessao do script precisa do valor agora).
export AI_MEMORY_LLM_PROVIDER="$PROVIDER"
export AI_MEMORY_LLM_MODEL="$MODEL"

PIDS="$(lsof -ti tcp:49374 2>/dev/null || true)"
if [[ -n "$PIDS" ]]; then
  kill -9 $PIDS 2>/dev/null || true
  sleep 1
fi

node "$HOME/.claude/hooks/ai-memory-ensure-server.mjs" >/dev/null 2>&1 || true
sleep 2
echo "Servidor ai-memory reiniciado nesse modo."
