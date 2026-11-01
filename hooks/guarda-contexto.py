#!/usr/bin/env python3
"""Guarda de contexto (UserPromptSubmit), criado em 2026-10-22 depois da análise de 30 dias.

1. Cache frio: depois de >55 min parado com >80k de contexto, o próximo turno regrava o
   contexto inteiro no cache (custo ~2x). Segura a mensagem uma vez e sugere /clear;
   reenviar nos próximos 15 min passa direto.
2. Troca de assunto: ao cruzar 120k, 160k e 200k, injeta um lembrete curto para o Claude
   sugerir /clear + handoff se o pedido novo não tem relação com a tarefa anterior.

Na análise, 64 retomadas frias custaram 33,5M tokens-eq/mês e turnos >250k foram 71% do gasto.
Desligar: MURI_GUARDA=0 no ambiente, ou remover o hook do settings.json.
"""
import json
import os
import sys
import time
from datetime import datetime

FRIO_MIN = 55
FRIO_CTX = 80_000
LIBERA_S = 15 * 60
MARCOS = (120_000, 160_000, 200_000)
ESTADO = os.path.expanduser("~/.claude/hooks/.guarda-contexto.json")


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
    """(contexto, timestamp) da última resposta com usage, lendo só o fim do transcript."""
    with open(caminho, "rb") as f:
        f.seek(0, 2)
        f.seek(max(0, f.tell() - 2_000_000))
        linhas = f.read().decode("utf-8", "ignore").splitlines()
    for linha in reversed(linhas):
        if '"usage"' not in linha:
            continue
        try:
            j = json.loads(linha)
        except ValueError:
            continue
        u = (j.get("message") or {}).get("usage")
        if not u or j.get("isSidechain"):
            continue
        ctx = u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0) + u.get("cache_read_input_tokens", 0)
        ts = datetime.fromisoformat(j["timestamp"].replace("Z", "+00:00")).timestamp()
        return ctx, ts
    return None


def main():
    if os.environ.get("MURI_GUARDA") == "0":
        return
    dados = json.load(sys.stdin)
    if (dados.get("prompt") or "").lstrip().startswith("/"):
        return
    if (dados.get("prompt") or "").strip() == "guarda-teste":  # prévia com os números reais, não mexe no estado
        ctx, ts = ultimo_uso(dados.get("transcript_path") or "") or (0, time.time())
        print(json.dumps(parar(aviso((time.time() - ts) / 60, ctx // 1000)), ensure_ascii=False))
        return
    sessao = dados.get("session_id", "")
    uso = ultimo_uso(dados.get("transcript_path") or "")
    if not uso:
        return
    ctx, ts = uso
    agora = time.time()

    try:
        estado = json.load(open(ESTADO))
    except (OSError, ValueError):
        estado = {}
    # Esquece sessões paradas há mais de 3 dias.
    estado = {k: v for k, v in estado.items() if agora - v.get("visto", 0) < 3 * 86400}
    s = estado.setdefault(sessao, {})
    s["visto"] = agora
    s["avisos"] = [m for m in s.get("avisos", []) if m <= ctx]  # depois de compactar, os marcos voltam

    saida = None
    parado = (agora - ts) / 60
    if parado > FRIO_MIN and ctx > FRIO_CTX and agora > s.get("liberado_ate", 0):
        s["liberado_ate"] = agora + LIBERA_S
        saida = parar(aviso(parado, ctx // 1000))
    else:
        novos = [m for m in MARCOS if ctx >= m and m not in s["avisos"]]
        if novos:
            s["avisos"] += novos
            saida = {
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": (
                        f"[guarda-contexto] Contexto em ~{ctx // 1000}k. Se este pedido não tem relação com a "
                        "tarefa anterior, ou ela já terminou, sugira /clear com o comando de handoff antes de "
                        "começar (regras de contexto e handoff do CLAUDE.md)."
                    ),
                }
            }

    with open(ESTADO, "w") as f:
        json.dump(estado, f)
    if saida:
        print(json.dumps(saida, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # nunca trava o prompt por erro do guarda
