#!/usr/bin/env python3
"""Guarda de contexto (UserPromptSubmit), criado em 2026-10-22 depois da análise de 30 dias.

1. Cache frio: parado além do TTL do cache (55 min com TTL de 1 h) com mais de 40% do ponto de
   auto-compact, o próximo turno regrava o contexto inteiro no cache (custo ~2x). Segura a
   mensagem uma vez e sugere /clear; reenviar nos próximos 15 min passa direto. O TTL vem do
   transcript: com TTL de 5 min (API, créditos, nuvem), só avisa, sem segurar. Depois de um
   compact_boundary (inclusive o idle compaction do Claude Code) vale o postTokens dele.
2. Troca de assunto: ao cruzar 70% e 90% do ponto de auto-compact, injeta um lembrete curto
   para o Claude sugerir /clear + handoff se o pedido novo não tem relação com a tarefa anterior.
3. Semanal: com o % semanal do ~/.claude.json em ≥70% e de novo em ≥90%, injeta um aviso
   uma vez por sessão.

Ponto de auto-compact = autoCompactWindow (o do modelo em modelSettings, onde o /autocompact
grava, ou o global), limitado à janela do modelo, menos ~33k. A janela e o modelo vêm da status
line, que grava o context_window_size do payload num cache; sem ele, supõe 200k (erra pro lado
seguro), ou 1M quando o contexto já passou de 200k ou o modelo tem [1m].

Na análise, 64 retomadas frias custaram 33,5M tokens-eq/mês e turnos >250k foram 71% do gasto.
Desligar: MURI_GUARDA=0 no ambiente, ou remover o hook do settings.json.
"""
import json
import os
import sys
import time
from datetime import datetime

FRIO_MIN = 55  # TTL de 1 h menos 5 min de folga
FRIO_FRAC = 0.40  # fração do ponto de compactação a partir da qual o cache frio pesa
LIBERA_S = 15 * 60
# shortcut: FOLGA medida só com 250k (compacta em 216-219k); remedir pelo compactMetadata.preTokens com outro valor.
FOLGA = 33_000
JANELA_200K, JANELA_1M = 200_000, 1_000_000
MARCOS_FRAC = (0.70, 0.90)  # fração do ponto de compactação; a status line usa as mesmas
SEMANAL = (70, 90)

HOME = os.environ.get("USERPROFILE") or os.path.expanduser("~")
CLAUDE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Rodando de um checkout do repo (não da instalação), o estado fica em ~/.claude.
if not any(os.path.exists(os.path.join(CLAUDE_DIR, f)) for f in ("settings.json", "muri-saver.json")):
    CLAUDE_DIR = os.path.join(HOME, ".claude")
ESTADO = os.path.join(CLAUDE_DIR, "hooks", ".guarda-contexto.json")
JANELAS = os.path.join(CLAUDE_DIR, "hooks", ".guarda-contexto-janela.json")  # gravado pela status line


def ler_json(caminho):
    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def gravar_json(caminho, dados):
    tmp = f"{caminho}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(dados, f)
    os.replace(tmp, caminho)  # atômico: quem lê ao mesmo tempo nunca vê o arquivo pela metade


def gravar_janela(sessao, janela, modelo):
    """Chamado pela status line: guarda janela e modelo da sessão (as 50 mais recentes) pro hook."""
    cache = ler_json(JANELAS)
    if cache.get(sessao) == [janela, modelo]:
        return
    cache.pop(sessao, None)
    cache[sessao] = [janela, modelo]
    gravar_json(JANELAS, dict(list(cache.items())[-50:]))


def auto_compact_window(modelo=None):
    """autoCompactWindow do modelo (modelSettings, onde o /autocompact grava) ou o global; None sem valor."""
    # shortcut: ignora CLAUDE_CODE_AUTO_COMPACT_WINDOW, --autocompact e settings de projeto; ler se alguém usar.
    s = ler_json(os.path.join(CLAUDE_DIR, "settings.json"))
    por_modelo = s.get("modelSettings") or {}
    for chave in (modelo, (modelo or "").split("[")[0]):
        w = (por_modelo.get(chave) or {}).get("autoCompactWindow") if chave else None
        if isinstance(w, int):
            return w
    w = s.get("autoCompactWindow")
    return w if isinstance(w, int) else None


def ponto_compactacao(janela=None, modelo=None, ctx=0):
    """Tokens em que o auto-compact dispara; guarda e status line usam a mesma conta."""
    janela = janela or (JANELA_1M if ctx > JANELA_200K or "[1m]" in (modelo or "") else JANELA_200K)
    w = min(auto_compact_window(modelo) or janela, janela)
    return max(w - FOLGA, w // 2)  # piso: com autoCompactWindow <= 33k o ponto daria zero ou negativo


def semanal():
    """% semanal (mesma fonte do usage-status.py); None sem dado."""
    try:
        u = ler_json(os.path.join(HOME, ".claude.json"))["cachedUsageUtilization"]["utilization"]
        return u["seven_day"]["utilization"]
    except (KeyError, TypeError):
        return None


# O Claude Code pinta o bloqueio de amarelo linha a linha: cada linha começa com reset pra ficar branca.
R, BRANCO, FORTE, CINZA, VERM = "\033[0m", "\033[97m", "\033[1;97m", "\033[90m", "\033[1;38;5;203m"
SELO = "\033[1;38;5;231;48;5;160m"


def duracao(minutos):
    m = int(minutos)
    if m >= 1440:
        return f"{m // 1440}d {m % 1440 // 60}h"
    return f"{m // 60}h {m % 60:02d}min" if m >= 60 else f"{m} min"


def aviso(parado_min, k):
    """Bloco do aviso de cache frio: texto branco, secundário cinza, alerta vermelho."""
    return "\n".join([
        "",  # o rótulo fixo "Operation stopped by hook:" fica sozinho na 1ª linha
        f"{R}{SELO} GUARDA-CONTEXTO {R}  {FORTE}Sessão parada há {duracao(parado_min)}{R} {VERM}· cache expirado{R}",
        "",
        f"{R}  {VERM}▍{R} {BRANCO}Contexto atual     {FORTE}{k}k tokens{R}",
        f"{R}  {VERM}▍{R} {BRANCO}Custo de retomar   {VERM}~{2 * k}k tokens-eq{R}  {CINZA}regrava o cache inteiro{R}",
        "",
        f"{R}  {FORTE}Recomendado{R}  {BRANCO}/clear{R} {CINZA}· o ai-memory grava o handoff e a próxima sessão já abre com ele (ou /compact){R}",
        f"{R}  {CINZA}Seguir assim mesmo: ↑ recupera a mensagem, reenvie em até 15 min{R}",
    ])


def parar(texto):
    # continue:false mostra só "Operation stopped by hook:"; o "decision: block" ainda acrescenta "Original prompt".
    return {"continue": False, "stopReason": texto}


def ultimo_uso(caminho):
    """(contexto, timestamp, ttl_min) da última resposta com usage, lendo só o fim do transcript.
    Um compact_boundary mais recente ganha: devolve o postTokens dele (ou None sem o campo).
    TTL: 5 se o último turno só gravou cache de 5 min; senão 60."""
    # shortcut: TTL só do último turno; turno sem cache_creation (raro) cai em 60, ler turnos anteriores se incomodar.
    with open(caminho, "rb") as f:
        f.seek(0, 2)
        f.seek(max(0, f.tell() - 2_000_000))
        linhas = f.read().decode("utf-8", "ignore").splitlines()
    for linha in reversed(linhas):
        if '"usage"' not in linha and '"compact_boundary"' not in linha:
            continue
        try:
            j = json.loads(linha)
        except ValueError:
            continue
        if j.get("isSidechain"):
            continue
        ts = lambda: datetime.fromisoformat(j["timestamp"].replace("Z", "+00:00")).timestamp()
        if j.get("subtype") == "compact_boundary":
            pos = (j.get("compactMetadata") or {}).get("postTokens")
            return (pos, ts(), 60) if pos is not None else None
        u = (j.get("message") or {}).get("usage")
        if not u:
            continue
        ctx = u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0) + u.get("cache_read_input_tokens", 0)
        cc = u.get("cache_creation") or {}
        ttl = 5 if cc.get("ephemeral_5m_input_tokens") and not cc.get("ephemeral_1h_input_tokens") else 60
        return ctx, ts(), ttl
    return None


def main():
    if os.environ.get("MURI_GUARDA") == "0":
        return
    dados = json.load(sys.stdin)
    if (dados.get("prompt") or "").lstrip().startswith("/"):
        return
    if (dados.get("prompt") or "").strip() == "guarda-teste":  # prévia com os números reais, não mexe no estado
        ctx, ts, _ = ultimo_uso(dados.get("transcript_path") or "") or (0, time.time(), 60)
        print(json.dumps(parar(aviso((time.time() - ts) / 60, ctx // 1000)), ensure_ascii=False))
        return
    sessao = dados.get("session_id", "")
    uso = ultimo_uso(dados.get("transcript_path") or "")
    if not uso:
        return
    ctx, ts, ttl = uso
    agora = time.time()
    janela, modelo = (ler_json(JANELAS).get(sessao) or [None, None])[:2]
    ponto = ponto_compactacao(janela, modelo, ctx)

    estado = ler_json(ESTADO)
    # Esquece sessões paradas há mais de 3 dias.
    estado = {k: v for k, v in estado.items() if agora - v.get("visto", 0) < 3 * 86400}
    s = estado.setdefault(sessao, {})
    s["visto"] = agora
    # Marcos guardados como fração do ponto: se o ponto muda na sessão, o mesmo marco não repete.
    s["avisos"] = [f for f in s.get("avisos", []) if f * ponto <= ctx]  # depois de compactar, os marcos voltam

    saida = None
    parado = (agora - ts) / 60
    if parado > min(FRIO_MIN, ttl) and ctx > FRIO_FRAC * ponto and agora > s.get("liberado_ate", 0):
        s["liberado_ate"] = agora + LIBERA_S
        if ttl >= 60:
            saida = parar(aviso(parado, ctx // 1000))
        else:  # TTL de 5 min: esfria em toda pausa curta, então só avisa
            saida = {"systemMessage": f"[guarda-contexto] Cache expirado (TTL de 5 min): este turno regrava "
                                      f"~{ctx // 1000}k tokens. Antes de uma pausa longa, prefira /clear ou /compact."}
    else:
        avisos = []
        novos = [f for f in MARCOS_FRAC if ctx >= f * ponto and f not in s["avisos"]]
        if novos:
            s["avisos"] += novos
            avisos.append(
                f"[guarda-contexto] Contexto em ~{ctx // 1000}k de ~{ponto // 1000}k (auto-compact). Se este pedido "
                "não tem relação com a tarefa anterior, ou ela já terminou, sugira /clear com o comando de handoff "
                "antes de começar (regras de contexto e handoff do CLAUDE.md)."
            )
        pct = semanal()
        nivel = max([n for n in SEMANAL if pct is not None and pct >= n], default=0)
        if nivel > s.get("semanal", 0):
            avisos.append(
                f"[guarda-contexto] Semanal em {round(pct)}% (cache do ~/.claude.json, trate como piso). "
                + ("Crítico: avise o usuário, delegue leitura e pesquisa e grave a síntese no ai-memory antes de "
                   "tarefa longa; em 100% para até o reset." if nivel >= 90 else
                   "Prefira sessões curtas e /compact antes de tarefa nova.")
            )
        s["semanal"] = nivel  # cai no reset semanal e os avisos voltam
        if avisos:
            saida = {"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": " ".join(avisos)}}

    if saida:  # antes de gravar: estado que não grava não engole o aviso
        print(json.dumps(saida, ensure_ascii=False))
    gravar_json(ESTADO, estado)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # nunca trava o prompt por erro do guarda
