#!/bin/bash
# Faxineiro (2026-10-31): rede de segurança contra vazamento dos hooks.
# Mata só o que é nosso: agy headless (-p / --input-format) com pai morto ou
# acima do teto, e worker do vault acima do teto. Dev server antigo (>3 dias)
# só vira aviso no macOS, 1x por dia. Roda pelo LaunchAgent com.muri.faxineiro.
# Uso: faxineiro.sh [--dry-run]   (dry-run lista e não mata nem avisa)
# Teste: bash ~/.claude/scripts/test-vault-hooks.sh (seção Faxineiro)
set -u
MAX_AGE=${FAXINA_MAX_AGE_S:-900}    # agy do hook leva até ~8,5 min e o do shim até ~8,3
DEV_AGE=${FAXINA_DEV_AGE_S:-259200} # 3 dias
AGY_RE=${FAXINA_AGY_RE:-'(^|/)agy (-p |--input-format )'}
WORKER_RE=${FAXINA_WORKER_RE:-'obsidian-vault-check\.mjs /'}
DEV_RE=${FAXINA_DEV_RE:-'node_modules/\.bin/(vite|nodemon|next|concurrently)|node --watch|http\.server|bin/postgres -D'}
LOG=${FAXINA_LOG:-$HOME/.claude/hooks/.faxineiro.log}
STATE=${FAXINA_STATE:-$HOME/.claude/hooks/.faxineiro-aviso}
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

secs() { # etime [[dd-]hh:]mm:ss -> segundos
  local t=$1 d=0 h=0 m s a b c
  case $t in *-*) d=${t%%-*}; t=${t#*-} ;; esac
  IFS=: read -r a b c <<< "$t"
  if [ -n "$c" ]; then h=$a; m=$b; s=$c; else m=$a; s=$b; fi
  echo $(( 10#$d * 86400 + 10#$h * 3600 + 10#$m * 60 + 10#$s ))
}

log() { echo "$(date '+%F %T') $*" >> "$LOG"; [ "$DRY" -eq 1 ] && echo "$*"; return 0; }

# imprime "pid ppid idade_s" de quem casa com o regex (ps só com campos curtos:
# a linha de comando do agy -p chega a 800KB e quebra o awk)
scan() {
  local p ppid et
  for p in $(pgrep -u "$(id -u)" -f "$1"); do # só do usuário: o postgres do sistema roda como _postgres
    read -r ppid et <<< "$(ps -o ppid=,etime= -p "$p" 2>/dev/null)"
    [ -n "${et:-}" ] && echo "$p $ppid $(secs "$et")"
  done
}

# worker primeiro: se o agy morrer antes, o worker tenta o próximo modelo e abre outro agy
scan "$WORKER_RE" | while read -r p ppid age; do
  [ "$age" -gt "$MAX_AGE" ] || continue
  log "mata worker do vault $p (${age}s)"
  [ "$DRY" -eq 1 ] || kill "$p" 2>/dev/null
done

scan "$AGY_RE" | while read -r p ppid age; do
  if [ "$ppid" = 1 ]; then why="órfão"; elif [ "$age" -gt "$MAX_AGE" ]; then why="acima do teto"; else continue; fi
  log "mata agy $p ($why, ${age}s)"
  [ "$DRY" -eq 1 ] || kill -9 "$p" 2>/dev/null
done

# Clones do Chrome: a cada abertura o Chrome clona o .app em code_sign_clone.* e só apaga ao sair
# limpo; Chrome headless morto por script deixa o clone pra trás. Apaga os com +1 dia cujo Chrome
# dono (aberto até 2 min do clone) já não roda.
T=$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null); T=${T%/}
CLONE_DIR=${FAXINA_CLONE_DIR:-$(dirname "${T:-/nao/existe/T}")/X/com.google.Chrome.code_sign_clone}
CLONE_AGE=${FAXINA_CLONE_AGE_S:-86400}
CHROME_RE=${FAXINA_CHROME_RE:-'MacOS/Google Chrome( --|$)'}
if [ -d "$CLONE_DIR" ]; then
  agora=$(date +%s)
  inicios=$(scan "$CHROME_RE" | while read -r p ppid age; do echo $((agora - age)); done)
  for d in "$CLONE_DIR"/code_sign_clone.*; do
    [ -d "$d" ] || continue
    m=$(stat -f %m "$d")
    [ $((agora - m)) -ge "$CLONE_AGE" ] || continue
    dono=0
    for i in $inicios; do dif=$((i - m)); [ "${dif#-}" -le 120 ] && dono=1; done
    [ "$dono" -eq 0 ] || continue
    log "apaga clone do Chrome ${d##*/} ($(( (agora - m) / 3600 ))h)"
    [ "$DRY" -eq 1 ] || rm -rf "$d"
  done
fi

old=$(scan "$DEV_RE" | while read -r p ppid age; do
  [ "$age" -gt "$DEV_AGE" ] || continue
  cwd=$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  echo "${cwd/#$HOME/~} ($((age / 86400))d)"
done | sort -u | tr '\n' ' ')
[ -n "$old" ] || exit 0
now=$(date +%s)
last=$(cat "$STATE" 2>/dev/null || echo 0)
if [ "$DRY" -eq 1 ]; then echo "dev server antigo: $old"; exit 0; fi
[ $((now - last)) -gt 86400 ] || exit 0
log "dev server antigo: $old"
echo "$now" > "$STATE"
[ "${FAXINA_NOTIFY:-1}" = 1 ] && osascript -e "display notification \"${old//\"/}\" with title \"Dev servers ligados há +3 dias\"" 2>/dev/null
exit 0
