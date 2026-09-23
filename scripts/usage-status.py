#!/usr/bin/env python3
"""Print current Claude Code usage/limit status, formatted pt-BR."""
import json
import os
from datetime import datetime, timezone, timedelta

BR_TZ = timezone(timedelta(hours=-3))
DIAS = ["segunda-feira", "terca-feira", "quarta-feira", "quinta-feira",
        "sexta-feira", "sabado", "domingo"]


def fmt_dt(dt):
    return f"{dt.day:02d}/{dt.month:02d}/{dt.year} as {dt.hour:02d}:{dt.minute:02d}"


def fmt_delta(delta):
    total = int(delta.total_seconds())
    if total <= 0:
        return "ja deveria ter resetado"
    days, rem = divmod(total, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, seconds = divmod(rem, 60)
    parts = []
    if days:
        parts.append(f"{days}d")
    if hours or days:
        parts.append(f"{hours}h")
    parts.append(f"{minutes}min")
    if not days and not hours:
        parts.append(f"{seconds}s")
    return " ".join(parts)


def level_tag(pct):
    if pct >= 90:
        return "CRITICO"
    if pct >= 75:
        return "ALERTA"
    if pct >= 50:
        return "ATENCAO"
    return "OK"


def main():
    path = os.path.join(os.environ.get("USERPROFILE", os.path.expanduser("~")), ".claude.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    cached = data["cachedUsageUtilization"]
    util = cached["utilization"]
    now_br = datetime.now(BR_TZ)
    weekday = DIAS[now_br.weekday()]

    print(f"Uso do Claude Code -- hoje, {weekday}, {fmt_dt(now_br)} (Brasilia)")

    # `cachedUsageUtilization` so FRESCA quanto a ultima vez que o proprio
    # Claude Code sincronizou com o servidor (normalmente ao abrir /usage ou
    # no inicio da sessao) -- NAO e recalculado em tempo real a cada turno.
    # Depois de uma sequencia pesada de tool calls sem reabrir /usage, o
    # numero aqui pode estar bem atras do uso real (achado real 2026-09-10:
    # mostrou 2% com o uso real ja em 18%). Avisar quando estiver velho em
    # vez de reportar silenciosamente um numero desatualizado.
    fetched_ms = cached.get("fetchedAtMs")
    if fetched_ms:
        fetched_dt = datetime.fromtimestamp(fetched_ms / 1000, tz=timezone.utc)
        age = datetime.now(timezone.utc) - fetched_dt
        age_min = int(age.total_seconds() // 60)
        if age_min >= 10:
            print(f"[AVISO] dado sincronizado ha {age_min}min -- pode estar desatualizado, "
                  f"abra /usage na sessao pra forcar um refresh antes de confiar no numero")
        else:
            print(f"(sincronizado ha {age_min}min)")
    print()

    for key, label in (("five_hour", "Janela de 5h "), ("seven_day", "Semanal (7d) ")):
        entry = util.get(key) or {}
        pct = entry.get("utilization")
        resets_at = entry.get("resets_at")
        if pct is None or not resets_at:
            print(f"{label}: sem dado disponivel")
            continue
        reset_dt = datetime.fromisoformat(resets_at).astimezone(BR_TZ)
        remaining = reset_dt - now_br
        print(f"{label}: {pct:3d}% usado [{level_tag(pct)}] -- reseta {fmt_dt(reset_dt)} -> faltam {fmt_delta(remaining)}")


if __name__ == "__main__":
    main()
