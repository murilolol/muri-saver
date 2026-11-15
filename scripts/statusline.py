#!/usr/bin/env python3
"""
Claude Code StatusLine - mesmo estilo visual e recursos do renderizador do
Antigravity (~/.gemini/scripts/usage-status.py): divisores em barra, cor por
limiar, dicas de contexto, indicador do ai-memory, branch git, barras de
quota 5h/7d (a de 5h some quando o plano não tem), auto-ajuste responsivo pra terminal estreito.
O contexto é medido contra o ponto de auto-compact (guarda-contexto.ponto_compactacao), não a janela.

  Largura normal:
  📁 dir │ 🌿 branch* │ 🧠 on │ ⏱ duração │ ▲ +add -rem │ ◔ 161k/467k ▓░ pct% → dica │ 5h ▓░ pct% → reset │ 7d ▓░ pct% → reset │ ◆ modelo

  Terminal estreito (<120 col), sem barras/dicas, só números:
  📁 dir │ 🌿 branch* │ ⏱ 19m │ ◔ 161k/467k 34% │ 5h 12% → 4h │ 7d 10% → 62h │ ◆ modelo

Lê o payload JSON oficial do statusLine do Claude Code via stdin (schema
confirmado em code.claude.com/docs/en/statusline.md): model, cwd/workspace,
context_window, cost, rate_limits. `rate_limits` só vem preenchido em contas
Pro/Max e só depois da 1ª resposta da API na sessão — quando ausente, o
segmento de quota é simplesmente omitido, nunca quebra o script.
"""
import json
import os
import sys
import shutil
import socket
import time
import importlib.util
from datetime import datetime, timezone

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ---- Paleta ANSI (igual ao statusline do Antigravity) ----------------------
COLOR = {
    "reset": "\x1b[0m",
    "white": "\x1b[37m",
    "green": "\x1b[32m",
    "yellow": "\x1b[33m",
    "red": "\x1b[31m",
    "gray": "\x1b[90m",
}
DIV = f" {COLOR['gray']}│{COLOR['reset']} "

PCT_YELLOW_AT = 70
PCT_RED_AT = 90

# Faixas do contexto = marcos do guarda-contexto (MARCOS_FRAC, fração do ponto de auto-compact)
CONTEXT_HINT_TIERS = [
    "tranquilo",
    "trocou de assunto? /clear",
    "/clear agora",
]
CONTEXT_TIER_COLOR = ("white", "yellow", "red")

BAR_FILLED = "▓"
BAR_EMPTY = "░"
BAR_WIDTH = 8


def build_bar(pct, width=BAR_WIDTH):
    clamped = max(0, min(100, pct))
    filled = min(width, round((clamped / 100.0) * width))
    return (BAR_FILLED * filled) + (BAR_EMPTY * (width - filled))


def pct_color(pct):
    if pct >= PCT_RED_AT:
        return COLOR["red"]
    if pct >= PCT_YELLOW_AT:
        return COLOR["yellow"]
    return COLOR["white"]


def build_inline_suffix(content):
    if not content:
        return ""
    return " " + COLOR["white"] + "→ " + content + COLOR["reset"]


def format_k(n):
    if n is None:
        return "0"
    if n >= 1000000:
        return f"{int(n / 1000000)}m"
    if n >= 1000:
        return f"{int(n / 1000)}k"
    return str(int(n))


def format_duration(ms):
    if not ms or ms < 0:
        return None
    total_secs = int(ms / 1000)
    hours = total_secs // 3600
    mins = (total_secs % 3600) // 60
    secs = total_secs % 60
    if hours > 0:
        return f"{hours}h {mins:02d}m {secs:02d}s"
    return f"{mins}m {secs:02d}s"


def format_duration_short(ms):
    if not ms or ms < 0:
        return None
    total_secs = int(ms / 1000)
    hours = total_secs // 3600
    mins = (total_secs % 3600) // 60
    if hours > 0:
        return f"{hours}h {mins:02d}m"
    return f"{mins}m"


def context_tier(pct_used, fracs):
    """0, 1 ou 2: quantos marcos (fração do ponto de auto-compact) o % já cruzou."""
    return sum(pct_used >= f * 100 for f in fracs)


def get_git_info(cwd):
    """Detector rápido de branch/dirty (mesma lógica do usage-status.py do AGY)."""
    try:
        cur = os.path.abspath(cwd)
        while cur:
            git_dir = os.path.join(cur, ".git")
            if os.path.isdir(git_dir):
                head_file = os.path.join(git_dir, "HEAD")
                if os.path.exists(head_file):
                    with open(head_file, "r", encoding="utf-8", errors="ignore") as f:
                        ref = f.read().strip()
                    if ref.startswith("ref: refs/heads/"):
                        branch = ref[len("ref: refs/heads/"):]
                    elif len(ref) >= 7:
                        branch = ref[:7]
                    else:
                        branch = "detached"
                    dirty = ""
                    try:
                        index_file = os.path.join(git_dir, "index")
                        if os.path.exists(index_file) and abs(os.path.getmtime(index_file) - os.path.getmtime(head_file)) > 1:
                            dirty = "*"
                    except Exception:
                        pass
                    return f"🌿 {branch}{dirty}"
                break
            parent = os.path.dirname(cur)
            if parent == cur:
                break
            cur = parent
    except Exception:
        pass
    return None


def check_ai_memory_online():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.03)
        result = s.connect_ex(("127.0.0.1", 49374))
        s.close()
        if result == 0:
            return True
    except Exception:
        pass
    return False


def countdown_from_epoch(reset_epoch_s):
    if not reset_epoch_s:
        return None
    try:
        diff = int(reset_epoch_s) - int(datetime.now(timezone.utc).timestamp())
        if diff <= 0:
            return None
        hours, rem = divmod(diff, 3600)
        mins = rem // 60
        return f"{hours}h {mins:02d}m" if hours else f"{mins}m"
    except Exception:
        return None


def load_guarda():
    caminho = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hooks", "guarda-contexto.py")
    spec = importlib.util.spec_from_file_location("guarda", caminho)
    g = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(g)
    return g


def guarda_segment(data, g, compact_at):
    """Cache que o guarda-contexto vigia: quanto falta pra esfriar, janela liberada ou selo de cache frio.
    Usa as regras, o TTL detectado e as cores do próprio hook pra nunca divergir dele."""
    try:
        uso = g.ultimo_uso(data.get("transcript_path") or "")
    except Exception:
        return None
    if not uso:
        return None
    ctx, ts, ttl = uso
    agora = time.time()
    parado = (agora - ts) / 60
    limite = min(g.FRIO_MIN, ttl)
    frio = ctx > g.FRIO_FRAC * compact_at
    if parado <= limite:
        resta = int(limite - parado)
        cor = g.VERM if resta < limite / 5 and frio else g.BRANCO
        return f"{cor}🛡 cache {resta}m{g.R}"
    liberado = g.ler_json(g.ESTADO).get(data.get("session_id", ""), {}).get("liberado_ate", 0)
    if agora < liberado:
        return f"{g.CINZA}🛡 liberado {int((liberado - agora) // 60)}m{g.R}"
    if frio:
        return f"{g.SELO} CACHE FRIO {g.R} {g.VERM}{g.duracao(parado)}{g.R}"
    return f"{g.CINZA}🛡 cache frio{g.R}"


def build_statusline():
    try:
        data = json.load(sys.stdin)
    except Exception:
        data = {}

    term_cols = shutil.get_terminal_size((120, 24)).columns
    is_narrow = term_cols < 120

    cwd = data.get("cwd") or (data.get("workspace") or {}).get("current_dir") or os.getcwd()
    dir_name = os.path.basename(os.path.normpath(cwd)) or cwd

    model_obj = data.get("model") or {}
    model_display = model_obj.get("display_name") or model_obj.get("id") or "Claude"

    ctx = data.get("context_window") or {}
    cost = data.get("cost") or {}
    rate_limits = data.get("rate_limits") or {}

    segments = [f"{COLOR['white']}📁 {dir_name}{COLOR['reset']}"]

    # Git branch
    git_info = get_git_info(cwd)
    if git_info:
        segments.append(f"{COLOR['white']}{git_info}{COLOR['reset']}")

    # ai-memory
    if not is_narrow:
        segments.append(
            f"{COLOR['white']}🧠 on{COLOR['reset']}" if check_ai_memory_online() else f"{COLOR['gray']}🧠 off{COLOR['reset']}"
        )

    # Duração da sessão
    dur_str = (format_duration(cost.get("total_duration_ms")) if not is_narrow
               else format_duration_short(cost.get("total_duration_ms")))
    if dur_str:
        segments.append(f"{COLOR['white']}⏱ {dur_str}{COLOR['reset']}")

    # Linhas adicionadas/removidas
    added = cost.get("total_lines_added")
    removed = cost.get("total_lines_removed")
    if added or removed:
        segments.append(
            f"{COLOR['white']}▲ {COLOR['green']}+{int(added or 0)}{COLOR['reset']} "
            f"{COLOR['red']}-{int(removed or 0)}{COLOR['reset']}"
        )

    try:
        g = load_guarda()
    except Exception:
        g = None

    # Contexto: tokens usados / ponto de auto-compact (mesma conta e marcos do guarda-contexto)
    used_tokens = ctx.get("total_input_tokens")
    if used_tokens is None:
        used_tokens = (ctx.get("current_usage") or {}).get("input_tokens")
    window_size = ctx.get("context_window_size")
    model_id = model_obj.get("id")
    if used_tokens is None and ctx.get("used_percentage") is not None and window_size:
        used_tokens = ctx["used_percentage"] * window_size / 100.0
    if g and window_size:
        try:
            g.gravar_janela(data.get("session_id", ""), window_size, model_id)  # o hook não recebe a janela
        except Exception:
            pass
    compact_at = g.ponto_compactacao(window_size, model_id) if g else (window_size or 200000)
    fracs = g.MARCOS_FRAC if g else (PCT_YELLOW_AT / 100, PCT_RED_AT / 100)
    # Só promete "compacta em Nk" quando N vem da janela do payload ou do autoCompactWindow, não de palpite.
    conhecido = bool(g and (window_size or g.auto_compact_window(model_id)))

    if used_tokens is not None:
        pct_int = round(used_tokens / float(compact_at) * 100)
        tier = context_tier(pct_int, fracs)
        color = COLOR[CONTEXT_TIER_COLOR[tier]]
        tokens_str = f"{format_k(used_tokens)}/{format_k(compact_at)}"
        if is_narrow:
            segments.append(f"{COLOR['white']}◔ {tokens_str} {color}{pct_int}%{COLOR['reset']}")
        else:
            bar = build_bar(pct_int)
            hint_text = CONTEXT_HINT_TIERS[tier]
            if tier == 2 and conhecido:
                hint_text += f" (compacta em {format_k(compact_at)})"
            core = f"{COLOR['white']}◔ {tokens_str} {color}{bar} {pct_int}%{COLOR['reset']}"
            segments.append(core + build_inline_suffix(hint_text))

    guarda = guarda_segment(data, g, compact_at) if g else None
    if guarda:
        segments.append(guarda)

    # Quotas 5h / 7d (rate_limits só vem em contas Pro/Max/Ultra, após a 1ª resposta da API; plano sem
    # janela de 5h manda five_hour null e o segmento some)
    for label, key in (("5h", "five_hour"), ("7d", "seven_day")):
        entry = rate_limits.get(key)
        if not entry:
            continue
        pct = entry.get("used_percentage")
        if pct is None:
            continue
        pct_int = round(float(pct))
        color = pct_color(pct_int)
        countdown = countdown_from_epoch(entry.get("resets_at"))
        if is_narrow:
            seg = f"{color}{label} {pct_int}%{COLOR['reset']}"
            seg += build_inline_suffix(countdown)
        else:
            bar = build_bar(pct_int)
            seg = f"{color}{label} {bar} {pct_int}%{COLOR['reset']}"
            seg += build_inline_suffix(countdown)
        segments.append(seg)

    # Modelo
    segments.append(f"{COLOR['white']}◆ {model_display}{COLOR['reset']}")

    return "  " + DIV.join(segments)


if __name__ == "__main__":
    try:
        print(build_statusline())
    except Exception:
        print("  📁 Claude Code")
