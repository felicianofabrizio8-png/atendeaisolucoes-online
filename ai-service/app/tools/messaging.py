"""Envio de mensagem e handoff humano.

Decisão de arquitetura que vale registrar: **este módulo não fala com a Meta.**

A integração WhatsApp/Meta do Atende Aí tem 657 linhas de tratamento de mídia,
token e dedupe (`api.public.whatsapp.webhook.tsx`) e um `sendWhatsappText`
com resultado tipado (`ai-agent.server.ts:511`). Reimplementar isso em Python
criaria dois caminhos de envio, dois lugares para bug de token e duas
contabilidades de janela de 24h.

O Python é Control Plane; o envio continua no Integration Plane em TS. Esta
ferramenta chama o endpoint interno existente, com a chave idempotente.

`send_message` está declarada, mas o cliente HTTP para o endpoint TS só entra
na FASE 8, junto com o Policy Engine completo — hoje a guarda barra antes.
"""

from __future__ import annotations

import time

from app.schemas.tools import HandoffRequest, MessageSent, ToolError
from app.tools.deps import AgentDeps
from app.tools.guards import ensure_can_act


async def send_message(deps: AgentDeps, text: str) -> MessageSent | ToolError:
    """Envia mensagem ao cliente.

    Idempotência: a chave deriva do turno (`deps.action_key`), então
    reprocessar o mesmo job não manda duas mensagens. Quem garante isso de
    fato é o endpoint TS, que precisa recusar chave repetida — ver TODO.
    """
    started = time.perf_counter()
    if (blocked := ensure_can_act(deps, "send_message")) is not None:
        deps.record("send_message", ok=False, duration_ms=_ms(started), error_code=blocked.code)
        return blocked

    if not text.strip():
        deps.record(
            "send_message", ok=False, duration_ms=_ms(started), error_code="invalid_input"
        )
        return ToolError(code="invalid_input", message="mensagem vazia")

    # TODO(fase 8): POST /api/internal/ai/send com
    #   { conversation_id, text, idempotency_key: deps.action_key("send_message") }
    #   e header x-ai-service-token. O endpoint TS precisa:
    #     1. validar o token;
    #     2. recusar idempotency_key já usada (tabela de chaves ou dedupe_key);
    #     3. reusar sendWhatsappText, sem duplicar a lógica de janela/token.
    deps.record(
        "send_message", ok=False, duration_ms=_ms(started), error_code="unavailable"
    )
    return ToolError(
        code="unavailable",
        message="envio ainda não conectado ao plano de integração (FASE 8)",
    )


async def human_handoff(deps: AgentDeps, reason: str) -> dict[str, str] | ToolError:
    """Marca a conversa para atendimento humano.

    Não passa por `ensure_can_act`: handoff é o caminho seguro, e bloqueá-lo
    prenderia a conversa com a IA exatamente quando ela concluiu que não
    deveria seguir. Vale em qualquer modo, inclusive `silent`.
    """
    started = time.perf_counter()
    request = HandoffRequest(conversation_id=deps.conversation_id, reason=reason)
    deps.record("human_handoff", ok=True, duration_ms=_ms(started))
    # A marcação em si é feita pelo workflow ao persistir a decisão, para
    # ficar numa transação só com o resto do estado do turno.
    return {"conversation_id": str(request.conversation_id), "reason": request.reason}


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


__all__ = ["human_handoff", "send_message"]
