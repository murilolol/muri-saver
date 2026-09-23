#!/usr/bin/env bash
# Smoke test pros hooks de saída (Stop) que gravam no Obsidian Vault:
#   ~/.claude/hooks/obsidian-vault-check.mjs   (Claude Code + Antigravity, mesmo arquivo)
#   ~/.codex/hooks/obsidian-codex-session.mjs  (Codex)
#
# Roda os hooks de verdade contra um HOME fake (nunca toca o vault real) com
# um repo git fake e transcrições/rollouts sintéticos, e valida a saída.
# Uso: bash ~/.claude/scripts/test-vault-hooks.sh
set -euo pipefail

WORKDIR="$(mktemp -d)"
FAKEHOME="$WORKDIR/fakehome"
REPO="$WORKDIR/fake_repo"
FAIL=0

cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

check() {
  local desc="$1" file="$2" pattern="$3"
  if grep -qF "$pattern" "$file" 2>/dev/null; then
    echo "  OK   $desc"
  else
    echo "  FAIL $desc (esperava conter: $pattern)"
    FAIL=1
  fi
}

# --- setup: repo git fake com 1 arquivo modificado (tracked) + 1 novo (untracked)
mkdir -p "$REPO" "$FAKEHOME"
(
  cd "$REPO"
  git init -q
  git config user.email t@t.com
  git config user.name t
  echo orig > tracked.txt
  git add tracked.txt
  git commit -qm init
  echo changed > tracked.txt
  echo new > untracked.txt
)

echo "=== Claude Code / Antigravity hook (obsidian-vault-check.mjs) ==="

TRANSCRIPT="$WORKDIR/transcript_muri.jsonl"
cat > "$TRANSCRIPT" <<'EOF'
{"type":"user","message":{"content":[{"type":"text","text":"muri saver, roda um teste rapido"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"tracked.txt"}}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"untracked.txt"}}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ls"}}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"TaskCreate","input":{"id":"t1"}}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"TaskUpdate","input":{"id":"t1","status":"completed"}}]}}
EOF

STDIN_JSON="$WORKDIR/stdin_claude.json"
printf '{"session_id":"smoketest-muri-0001","transcript_path":"%s","cwd":"%s","hook_event_name":"Stop"}' \
  "$TRANSCRIPT" "$REPO" > "$STDIN_JSON"

HOME="$FAKEHOME" node ~/.claude/hooks/obsidian-vault-check.mjs < "$STDIN_JSON" > /dev/null

SESSION_FILE=$(find "$FAKEHOME/Documents/Obsidian Vault/claude/sessions" -name "*.md" 2>/dev/null | head -1)
if [ -z "${SESSION_FILE:-}" ]; then
  echo "  FAIL nenhum arquivo de sessão gerado (esperado em claude/sessions/)"
  FAIL=1
else
  check "detectou modo muri-saver via 'muri saver' (espaço)" "$SESSION_FILE" "Modo Muri-Saver"
  check "bloco de metadados locais presente" "$SESSION_FILE" "📊 Metadados Locais"
  check "contagem de comandos correta (5)" "$SESSION_FILE" "Comandos/ações executados:** 5"
  check "status de task correto (1/1)" "$SESSION_FILE" "1/1 tasks concluídas"
  check "arquivo tracked (git diff) capturado" "$SESSION_FILE" "tracked.txt"
  check "arquivo untracked (git status) capturado" "$SESSION_FILE" "untracked.txt"
fi

echo
echo "=== Codex hook (obsidian-codex-session.mjs) ==="

CODEX_SESSION_ID="0000aaaa-1111-bbbb-2222-cccc33334444"
ROLLOUT_DIR="$FAKEHOME/.codex/sessions/2026/01/01"
mkdir -p "$ROLLOUT_DIR"
ROLLOUT_FILE="$ROLLOUT_DIR/rollout-2026-01-01T00-00-00-$CODEX_SESSION_ID.jsonl"
cat > "$ROLLOUT_FILE" <<EOF
{"type":"session_meta","payload":{"session_id":"$CODEX_SESSION_ID"}}
{"type":"response_item","payload":{"type":"function_call","name":"exec"}}
{"type":"response_item","payload":{"type":"function_call","name":"exec"}}
{"type":"response_item","payload":{"type":"custom_tool_call","name":"exec"}}
EOF

STDIN_CODEX="$WORKDIR/stdin_codex.json"
printf '{"session_id":"%s","cwd":"%s"}' "$CODEX_SESSION_ID" "$REPO" > "$STDIN_CODEX"

HOME="$FAKEHOME" node ~/.codex/hooks/obsidian-codex-session.mjs < "$STDIN_CODEX" > /dev/null

CODEX_FILE=$(find "$FAKEHOME/Documents/Obsidian Vault/codex/sessions" -name "*.md" 2>/dev/null | head -1)
if [ -z "${CODEX_FILE:-}" ]; then
  echo "  FAIL nenhum arquivo de sessão gerado (esperado em codex/sessions/)"
  FAIL=1
else
  check "achou o rollout pelo session_id e contou comandos (3)" "$CODEX_FILE" "Comandos/ações executados: 3"
  check "arquivo tracked (git) capturado" "$CODEX_FILE" "tracked.txt"
  check "arquivo untracked (git) capturado" "$CODEX_FILE" "untracked.txt"
fi

# --- teto de tamanho do rollout (achado: sessão real gerou rollout de 125MB)
CODEX_SESSION_ID2="0000aaaa-1111-bbbb-2222-cccc99998888"
ROLLOUT_BIG="$ROLLOUT_DIR/rollout-2026-01-01T00-00-01-$CODEX_SESSION_ID2.jsonl"
truncate -s 31M "$ROLLOUT_BIG"
STDIN_CODEX2="$WORKDIR/stdin_codex2.json"
printf '{"session_id":"%s","cwd":"%s"}' "$CODEX_SESSION_ID2" "$REPO" > "$STDIN_CODEX2"
HOME="$FAKEHOME" node ~/.codex/hooks/obsidian-codex-session.mjs < "$STDIN_CODEX2" > /dev/null
CODEX_FILE2=$(find "$FAKEHOME/Documents/Obsidian Vault/codex/sessions" -name "*8888*.md" 2>/dev/null | head -1)
if [ -z "${CODEX_FILE2:-}" ]; then
  echo "  FAIL nenhum arquivo de sessão gerado pro caso de rollout grande"
  FAIL=1
elif grep -q "Comandos/ações executados" "$CODEX_FILE2"; then
  echo "  FAIL teto de 30MB não foi respeitado (tentou contar comandos de um rollout de 31MB)"
  FAIL=1
else
  echo "  OK   teto de 30MB respeitado (pulou contagem sem travar)"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "TUDO OK — nenhum arquivo real do vault foi tocado (HOME fake: $WORKDIR)"
else
  echo "FALHAS ENCONTRADAS — ver acima"
fi
exit "$FAIL"
