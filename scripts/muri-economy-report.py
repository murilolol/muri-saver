#!/usr/bin/env python3
"""Relatório de economia real do muri-saver.

Junta o que dá pra medir de verdade:
  - transcripts do Claude Code (~/.claude/projects/**/*.jsonl): tokens reais por turno;
  - cota do plano (cache do Claude Code em ~/.claude.json, ou o app Maestri se existir)
    + histórico próprio gravado pelo job quota-snapshot;
  - trabalho feito FORA da cota do Claude: muri-delegate, shim do ai-memory,
    narrativas do vault e backfill.

Uso:
  muri-economy-report.py                 relatório dos últimos 7 dias no terminal
  muri-economy-report.py --days 14
  muri-economy-report.py --save          também grava no vault (overview/economia/)
  muri-economy-report.py --snapshot      só anexa a cota atual ao histórico (job quota-snapshot)

Os "tokens-eq" são uma estimativa de peso na cota: preço relativo de API por tipo
de token × fator do modelo (tabelas abaixo). A Anthropic não publica a fórmula da
cota do plano; a calibração "1% semanal ≈ X tokens-eq" sai dos próprios dados.
"""
import argparse
import glob
import json
import os
import re
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

HOME = os.path.expanduser("~")
SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
CLAUDE_DIR = os.path.dirname(SCRIPTS_DIR)
# Rodando de um checkout do repo (não da instalação), os dados ficam em ~/.claude.
if not any(os.path.exists(os.path.join(CLAUDE_DIR, f)) for f in ("settings.json", "muri-saver.json")):
    CLAUDE_DIR = os.path.join(HOME, ".claude")
    SCRIPTS_DIR = os.path.join(CLAUDE_DIR, "scripts")
HOOKS_DIR = os.path.join(CLAUDE_DIR, "hooks")


def load_config():
    for p in (os.environ.get("MURI_SAVER_CONFIG"), os.path.join(CLAUDE_DIR, "muri-saver.json"),
              os.path.join(HOME, ".claude", "muri-saver.json")):
        if not p:
            continue
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            continue
    return {}


CFG = load_config()


def local_tz():
    """Fuso do muri-saver.json; sem tzdata (Windows sem o pacote), o fuso do sistema."""
    name = os.environ.get("MURI_SAVER_TZ") or CFG.get("timezone")
    if name:
        try:
            from zoneinfo import ZoneInfo
            return ZoneInfo(name)
        except Exception:
            pass
    return datetime.now().astimezone().tzinfo


TZ = local_tz()
PROJECTS_DIR = os.path.join(HOME, ".claude", "projects")
MAESTRI_STATUS = os.path.join(HOME, ".maestri", "usage", "providers", ".status.json")
CLAUDE_JSON = os.path.join(HOME, ".claude.json")
QUOTA_HISTORY = os.path.join(SCRIPTS_DIR, ".quota-history.jsonl")
DELEGATIONS_LOG = os.path.join(SCRIPTS_DIR, ".delegations.log")
SHIM_LOG = os.path.join(HOOKS_DIR, ".ai-memory-llm-shim.log")
VAULT_LLM_LOG = os.path.join(HOOKS_DIR, ".vault-llm.log")
BACKFILL_LOG = os.path.join(HOOKS_DIR, ".vault-backfill.log")
_vault = os.environ.get("OBSIDIAN_VAULT") or (CFG["vault"] if "vault" in CFG else os.path.join(HOME, "Documents", "Obsidian Vault"))
VAULT_OUT = os.path.join(os.path.expanduser(_vault), "overview", "economia") if _vault else None

# Corte opcional para comparar o custo fixo por sessão antes × depois de uma
# mudança (ex.: o dia em que você enxugou CLAUDE.md/skills). economy.cutoff no
# muri-saver.json ou --cutoff.
DEFAULT_CUTOFF = (CFG.get("economy") or {}).get("cutoff")

# Preço relativo por tipo de token (input = 1), igual em todos os modelos.
TOKEN_WEIGHTS = {"input": 1.0, "cache_write_5m": 1.25, "cache_write_1h": 2.0,
                 "cache_read": 0.1, "output": 5.0}
# Fator do modelo em relação ao Opus (aproximado; ajuste se os preços mudarem).
MODEL_FACTORS = {"opus": 1.0, "fable": 1.0, "sonnet": 0.6, "haiku": 0.2}
CHARS_PER_TOKEN = 4
DIAS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def model_factor(model):
    m = (model or "").lower()
    for key, f in MODEL_FACTORS.items():
        if key in m:
            return f
    return 1.0


def short_model(model):
    m = re.sub(r"^claude-", "", model or "?")
    return re.sub(r"-\d{8}$", "", m)


def fmt_k(n):
    if n >= 1e6:
        return f"{n / 1e6:.1f}M".replace(".", ",")
    if n >= 1e3:
        return f"{n / 1e3:.0f}k"
    return f"{n:.0f}"


def fmt_pp(x):
    return f"{x:.1f}".replace(".", ",")


def brt(dt):
    return dt.astimezone(TZ).strftime("%d/%m %H:%M")


# ---------------------------------------------------------------- cota

def current_quota():
    """Lista de {provider, meter, window, used, resetsAt} a partir do Maestri;
    sem Maestri, cai pro cache do próprio Claude Code (~/.claude.json)."""
    rows, source = [], None
    try:
        with open(MAESTRI_STATUS, encoding="utf-8") as f:
            data = json.load(f)
        for p in data.get("providers", []):
            if p.get("state") != "ready":
                continue
            for m in p.get("meters", []):
                for w in m.get("windows", []):
                    if w.get("usedPercent") is None:
                        continue
                    rows.append({"provider": p["id"], "meter": m.get("label") or m.get("id"),
                                 "window": w.get("id") or w.get("title"), "title": w.get("title"),
                                 "used": round(float(w["usedPercent"]), 1),
                                 "resetsAt": w.get("resetsAt")})
        source = "maestri"
    except (OSError, ValueError, KeyError):
        pass
    if not any(r["provider"] == "claude" for r in rows):
        try:
            with open(CLAUDE_JSON, encoding="utf-8") as f:
                util = json.load(f)["cachedUsageUtilization"]["utilization"]
            for key, title in (("five_hour", "Sessão"), ("seven_day", "Semanal")):
                e = util.get(key) or {}
                if e.get("utilization") is not None:
                    rows.append({"provider": "claude", "meter": "Limites do plano", "window": key,
                                 "title": title, "used": round(float(e["utilization"]), 1),
                                 "resetsAt": e.get("resets_at")})
            source = source or "claude.json"
        except (OSError, ValueError, KeyError):
            pass
    return rows, source


def snapshot():
    rows, source = current_quota()
    if not rows:
        print("sem dado de cota (~/.claude.json sem cache; abra o Claude Code e rode /usage)", file=sys.stderr)
        return 1
    rec = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "source": source, "quota": rows}
    with open(QUOTA_HISTORY, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return 0


def quota_history(since):
    out = []
    try:
        with open(QUOTA_HISTORY, encoding="utf-8") as f:
            for line in f:
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if parse_ts(rec["ts"]) >= since:
                    out.append(rec)
    except OSError:
        pass
    return out


# ---------------------------------------------------------------- transcripts

def load_turns(since):
    """Um registro por mensagem do assistente (dedupe por message.id)."""
    turns = {}
    cutoff_mtime = since.timestamp() - 3600
    for path in glob.glob(os.path.join(PROJECTS_DIR, "**", "*.jsonl"), recursive=True):
        try:
            if os.path.getmtime(path) < cutoff_mtime:
                continue
            fh = open(path, encoding="utf-8", errors="replace")
        except OSError:
            continue
        is_sub = f"{os.sep}subagents{os.sep}" in path
        with fh:
            for line in fh:
                if '"usage"' not in line or '"assistant"' not in line:
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                msg = d.get("message") or {}
                u = msg.get("usage")
                ts = d.get("timestamp")
                if d.get("type") != "assistant" or not u or not ts:
                    continue
                if msg.get("model") == "<synthetic>":
                    continue
                t = parse_ts(ts)
                if t < since:
                    continue
                cc = u.get("cache_creation") or {}
                w1h = cc.get("ephemeral_1h_input_tokens")
                w5m = cc.get("ephemeral_5m_input_tokens")
                cw = u.get("cache_creation_input_tokens") or 0
                if w1h is None and w5m is None:
                    w5m, w1h = cw, 0
                key = msg.get("id") or d.get("requestId") or f"{path}:{ts}"
                turns[key] = {
                    "ts": t, "file": path, "session": d.get("sessionId"),
                    "sub": is_sub or bool(d.get("isSidechain")),
                    "model": msg.get("model"),
                    "input": u.get("input_tokens") or 0,
                    "cache_write_5m": w5m or 0, "cache_write_1h": w1h or 0,
                    "cache_read": u.get("cache_read_input_tokens") or 0,
                    "output": u.get("output_tokens") or 0,
                }
    return sorted(turns.values(), key=lambda r: r["ts"])


def eq_tokens(t):
    base = sum(t[k] * w for k, w in TOKEN_WEIGHTS.items())
    return base * model_factor(t["model"])


def prompt_tokens(t):
    return t["input"] + t["cache_write_5m"] + t["cache_write_1h"] + t["cache_read"]


# ---------------------------------------------------------------- logs fora do Claude

def read_lines(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read().splitlines()
    except OSError:
        return []


def delegations(since):
    agg = defaultdict(lambda: {"n": 0, "ok": 0, "secs": 0, "bytes": 0, "modes": defaultdict(int)})
    for line in read_lines(DELEGATIONS_LOG):
        p = line.split("\t")
        if len(p) < 8:
            continue
        try:
            t = datetime.strptime(p[0], "%Y-%m-%dT%H:%M:%S%z")
        except ValueError:
            continue
        if t < since:
            continue
        a = agg[p[1]]
        a["n"] += 1
        a["ok"] += p[6] == "rc=0"
        a["secs"] += int(p[5].rstrip("s") or 0)
        a["bytes"] += int(p[7].rstrip("B") or 0)
        a["modes"][p[4]] += 1
    return agg


def shim_calls(since):
    agg = defaultdict(lambda: {"n": 0, "secs": 0.0, "in": 0, "out": 0})
    fails = 0
    for line in read_lines(SHIM_LOG):
        p = line.split(" ")
        if len(p) < 3:
            continue
        try:
            t = parse_ts(p[0])
        except ValueError:
            continue
        if t < since:
            continue
        if p[1] == "FALHOU":
            fails += 1
        if p[1] != "ok":
            continue
        a = agg[p[2].split(":", 1)[0]]
        a["n"] += 1
        m = re.search(r" ([\d.]+)s in=(\d+) out=(\d+)", line)
        if m:
            a["secs"] += float(m.group(1))
            a["in"] += int(m.group(2))
            a["out"] += int(m.group(3))
    return agg, fails


def vault_calls(since):
    n, secs, in_tok, out_tok = 0, 0.0, 0, 0
    for line in read_lines(VAULT_LLM_LOG):
        p = line.split("\t")
        if len(p) < 6 or p[1] != "ok":
            continue
        try:
            if parse_ts(p[0]) < since:
                continue
        except ValueError:
            continue
        n += 1
        secs += float(p[3].rstrip("s"))
        in_tok += int(p[4].split("=")[1]) // CHARS_PER_TOKEN
        out_tok += int(p[5].split("=")[1]) // CHARS_PER_TOKEN
    ok = fail = 0
    for line in read_lines(BACKFILL_LOG):
        p = line.split(" ", 2)
        if len(p) < 2:
            continue
        try:
            if parse_ts(p[0]) < since:
                continue
        except ValueError:
            continue
        ok += p[1] == "ok"
        fail += p[1] == "falhou"
    return {"n": n, "secs": secs, "in": in_tok, "out": out_tok, "backfill_ok": ok, "backfill_fail": fail}


# ---------------------------------------------------------------- relatório

def build_report(days, cutoff):
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    quota, qsource = current_quota()
    claude_q = {r["window"]: r for r in quota if r["provider"] == "claude"}
    # Lê desde o início da janela semanal atual se ela for mais antiga que o período.
    wk = claude_q.get("seven_day")
    wk_start = parse_ts(wk["resetsAt"]) - timedelta(days=7) if wk and wk.get("resetsAt") else None
    turns = load_turns(min(since, wk_start) if wk_start else since)
    period = [t for t in turns if t["ts"] >= since]

    L = []
    L.append(f"# Economia real — {now.astimezone(TZ):%d/%m/%Y %H:%M} ({CFG.get('timezone') or 'fuso local'})")
    L.append("")
    L.append(f"Período: últimos {days} dias (desde {brt(since)}). Tokens-eq = peso estimado na cota "
             f"(input 1, cache write 1,25/2, cache read 0,1, output 5; Sonnet 0,6, Haiku 0,2).")
    L.append("")

    # 1. Cota agora
    L.append("## 1. Cota agora")
    L.append("")
    if quota:
        L.append(f"Fonte: {qsource}.")
        L.append("")
        L.append("| Provedor | Medidor | Janela | Uso | Reseta |")
        L.append("|---|---|---|---:|---|")
        for r in quota:
            rs = brt(parse_ts(r["resetsAt"])) if r.get("resetsAt") else "-"
            L.append(f"| {r['provider']} | {r['meter']} | {r['title']} | {r['used']:.0f}% | {rs} |")
    else:
        L.append("Sem dado de cota (sem cache no ~/.claude.json; abra o Claude Code e rode /usage).")
    L.append("")

    # 2. Consumo do Claude
    L.append("## 2. Consumo do Claude no período")
    L.append("")
    by_model = defaultdict(lambda: defaultdict(float))
    for t in period:
        m = by_model[short_model(t["model"]) + (" (subagente)" if t["sub"] else "")]
        m["turns"] += 1
        for k in TOKEN_WEIGHTS:
            m[k] += t[k]
        m["eq"] += eq_tokens(t)
    total_eq = sum(m["eq"] for m in by_model.values()) or 1
    L.append("| Modelo | Turnos | Input | Cache write | Cache read | Output | Tokens-eq | % |")
    L.append("|---|---:|---:|---:|---:|---:|---:|---:|")
    for name, m in sorted(by_model.items(), key=lambda kv: -kv[1]["eq"]):
        L.append(f"| {name} | {m['turns']:.0f} | {fmt_k(m['input'])} | "
                 f"{fmt_k(m['cache_write_5m'] + m['cache_write_1h'])} | {fmt_k(m['cache_read'])} | "
                 f"{fmt_k(m['output'])} | {fmt_k(m['eq'])} | {100 * m['eq'] / total_eq:.0f}% |")
    L.append("")
    by_day = defaultdict(lambda: [0.0, set()])
    for t in period:
        local = t["ts"].astimezone(TZ)
        d = by_day[f"{DIAS[local.weekday()]} {local:%d/%m}"]
        d[0] += eq_tokens(t)
        if not t["sub"]:
            d[1].add(t["session"])
    L.append("| Dia | Sessões | Tokens-eq |")
    L.append("|---|---:|---:|")
    for day, (eq, sess) in by_day.items():
        L.append(f"| {day} | {len(sess)} | {fmt_k(eq)} |")
    L.append("")

    # 3. Calibração com a cota
    L.append("## 3. Quanto vale 1% da cota")
    L.append("")
    per_pct_week = None
    for key, label in (("seven_day", "semanal"), ("five_hour", "5h")):
        q = claude_q.get(key)
        if not q or not q.get("resetsAt") or not q["used"]:
            continue
        start = parse_ts(q["resetsAt"]) - timedelta(seconds=604800 if key == "seven_day" else 18000)
        eq = sum(eq_tokens(t) for t in turns if t["ts"] >= start)
        per_pct = eq / q["used"]
        if key == "seven_day":
            per_pct_week = per_pct
        L.append(f"- Janela {label} (desde {brt(start)}): {fmt_k(eq)} tokens-eq locais para {q['used']:.0f}% "
                 f"→ **1% ≈ {fmt_k(per_pct)} tokens-eq**.")
    if per_pct_week is None:
        L.append("- Sem cota semanal disponível pra calibrar.")
    L.append("- É um teto: uso no claude.ai (web/desktop) ou em outra máquina conta na mesma cota "
             "e não aparece nos transcripts locais, o que faz 1% parecer menor do que é.")
    L.append("")

    # 4. Custo fixo por sessão (antes × depois do corte)
    L.append("## 4. Custo fixo por sessão (1º turno)")
    L.append("")
    if not cutoff:
        L.append("Sem corte definido. Use `--cutoff AAAA-MM-DDTHH:MM:SSZ` (ou economy.cutoff no muri-saver.json) "
                 "para comparar o 1º turno das sessões antes e depois de uma mudança nas instruções.")
        L.append("")
        cutoff = "2999-01-01T00:00:00Z"
    cut = parse_ts(cutoff)
    first, nturns = {}, defaultdict(int)
    for t in turns:
        if t["sub"] or "opus" not in (t["model"] or ""):
            continue
        nturns[t["file"]] += 1
        if t["file"] not in first:
            first[t["file"]] = t
    before = [(prompt_tokens(t), nturns[f]) for f, t in first.items() if t["ts"] < cut]
    after = [(prompt_tokens(t), nturns[f]) for f, t in first.items() if t["ts"] >= cut]
    if before and after:
        mb = statistics.median(p for p, _ in before)
        ma = statistics.median(p for p, _ in after)
        minb, mina = min(p for p, _ in before), min(p for p, _ in after)
        # Conservador: o menor entre o delta das medianas e o dos mínimos (o 1º turno
        # carrega também o prompt do usuário e o contexto do SessionStart).
        delta = min(mb - ma, minb - mina)
        med_turns = statistics.median(n for _, n in before + after)
        sess_week = len([1 for t in first.values() if t["ts"] >= since]) * 7 / days
        # O prefixo fixo é gravado no cache 1x (peso 2, TTL 1h) e lido nos demais turnos (0,1).
        per_session = delta * (TOKEN_WEIGHTS["cache_write_1h"] + TOKEN_WEIGHTS["cache_read"] * (med_turns - 1))
        per_week = per_session * sess_week
        L.append(f"Só sessões Opus principais; corte em {brt(cut)}.")
        L.append("")
        L.append("| | Sessões | Mediana do 1º turno | Mínimo (≈ só o fixo) |")
        L.append("|---|---:|---:|---:|")
        L.append(f"| Antes | {len(before)} | {fmt_k(mb)} | {fmt_k(minb)} |")
        L.append(f"| Depois | {len(after)} | {fmt_k(ma)} | {fmt_k(mina)} |")
        L.append("")
        L.append(f"- Diferença (conservadora): **{fmt_k(delta)} tokens por turno** "
                 f"(medianas {fmt_k(mb - ma)}, mínimos {fmt_k(minb - mina)}).")
        L.append(f"- Com {med_turns:.0f} turnos (mediana) e ~{sess_week:.0f} sessões/semana: "
                 f"≈ {fmt_k(per_session)} tokens-eq por sessão, {fmt_k(per_week)} por semana.")
        if per_pct_week:
            L.append(f"- Na cota semanal: **≈ {fmt_pp(per_week / per_pct_week)} pontos percentuais por semana**.")
        if len(after) < 5:
            L.append(f"- Só {len(after)} {'sessão' if len(after) == 1 else 'sessões'} depois do corte: número provisório. "
                     "Rode de novo daqui a uns dias.")
    else:
        L.append(f"Sem sessões dos dois lados do corte ({brt(cut)}) no período.")
    L.append("")

    # 5. Fora da cota do Claude
    L.append("## 5. Trabalho feito fora da cota do Claude")
    L.append("")
    dl = delegations(since)
    sh, sh_fail = shim_calls(since)
    vc = vault_calls(since)
    L.append("| Origem | Chamadas ok | Tempo | Volume |")
    L.append("|---|---:|---:|---|")
    for agent, a in sorted(dl.items()):
        modes = ", ".join(f"{k} {v}" for k, v in sorted(a["modes"].items()))
        L.append(f"| muri-delegate → {agent} ({modes}) | {a['ok']}/{a['n']} | {a['secs'] / 60:.0f} min | "
                 f"{fmt_k(a['bytes'] / CHARS_PER_TOKEN)} tokens devolvidos ao Claude |")
    for kind, a in sorted(sh.items()):
        L.append(f"| ai-memory via {kind} | {a['n']} | {a['secs'] / 60:.0f} min | "
                 f"{fmt_k(a['in'])} in + {fmt_k(a['out'])} out |")
    if sh_fail:
        L.append(f"| ai-memory (cadeia inteira falhou) | 0/{sh_fail} | - | - |")
    if vc["n"]:
        L.append(f"| Narrativas do vault (cadeia de narrativa) | {vc['n']} | {vc['secs'] / 60:.0f} min | "
                 f"≈ {fmt_k(vc['in'])} in + {fmt_k(vc['out'])} out |")
    if vc["backfill_ok"] or vc["backfill_fail"]:
        L.append(f"| Backfill do vault | {vc['backfill_ok']}/{vc['backfill_ok'] + vc['backfill_fail']} | - | "
                 f"(tokens já contados na linha de narrativas) |")
    L.append("")
    if vc["n"]:
        # Sem a cadeia de narrativa, o natural seria o Haiku, na cota do Claude.
        haiku_eq = (vc["in"] * TOKEN_WEIGHTS["input"] + vc["out"] * TOKEN_WEIGHTS["output"]) * MODEL_FACTORS["haiku"]
        line = f"- Narrativas: no Haiku custariam ≈ {fmt_k(haiku_eq)} tokens-eq da cota do Claude"
        if per_pct_week:
            line += f" (≈ {fmt_pp(haiku_eq / per_pct_week)} p.p. da cota semanal)"
        L.append(line + ".")
    if not dl:
        L.append("- Nenhuma delegação via muri-delegate no período.")
    L.append("- As delegações não têm contrafactual medível (quanto o Claude teria lido). "
             "A tabela mostra só o que saiu dele e quanto voltou.")
    L.append("")

    # 6. Histórico da cota
    hist = quota_history(since)
    L.append("## 6. Histórico da cota do Claude")
    L.append("")
    if hist:
        peaks = defaultdict(float)
        for rec in hist:
            for r in rec["quota"]:
                if r["provider"] == "claude" and r["window"] == "seven_day" and r.get("resetsAt"):
                    peaks[r["resetsAt"]] = max(peaks[r["resetsAt"]], r["used"])
        L.append(f"{len(hist)} snapshots no período.")
        L.append("")
        L.append("| Semana (reset) | Pico do uso semanal |")
        L.append("|---|---:|")
        for rs, pk in sorted(peaks.items()):
            L.append(f"| {brt(parse_ts(rs))} | {pk:.0f}% |")
    else:
        L.append("Sem snapshots ainda. O job `quota-snapshot` (muri-saver jobs install quota-snapshot) grava um por hora em "
                 "`.quota-history.jsonl`, ao lado deste script.")
    L.append("")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--cutoff", default=DEFAULT_CUTOFF, help="ISO do corte antes/depois (custo fixo)")
    ap.add_argument("--save", action="store_true", help="grava em overview/economia/ no vault")
    ap.add_argument("--snapshot", action="store_true", help="só anexa a cota atual ao histórico")
    args = ap.parse_args()
    if args.snapshot:
        return snapshot()
    report = build_report(args.days, args.cutoff)
    print(report)
    if args.save:
        if not VAULT_OUT:
            print("\n(--save ignorado: Obsidian desativado nesta instalação)", file=sys.stderr)
            return 0
        os.makedirs(VAULT_OUT, exist_ok=True)
        name = f"Economia-{datetime.now(TZ):%Y-%m-%d}.md"
        front = ("---\ntags: [economia, muri-saver, relatorio]\n"
                 f"periodo_dias: {args.days}\ngerado: {datetime.now(TZ).isoformat(timespec='minutes')}\n---\n\n")
        with open(os.path.join(VAULT_OUT, name), "w", encoding="utf-8") as f:
            f.write(front + report + "\n")
        print(f"\n(salvo em {os.path.join(VAULT_OUT, name)})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
