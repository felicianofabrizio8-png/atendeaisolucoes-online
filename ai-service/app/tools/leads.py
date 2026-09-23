"""Lead: leitura e atualização de qualificação.

`update_lead_state` é escrita **interna** — grava em `conversations`, sem efeito
fora do sistema. Por isso passa por `ensure_can_write` e não por
`ensure_can_act`: em modo `silent` ela é bloqueada (o agente só observa), em
`assisted` já pode gravar (a qualificação detectada é útil para o humano que
vai aprovar a resposta).

Mudança de `status` do funil NÃO está aqui de propósito: é decisão comercial,
vai pelo Policy Engine como ação.
"""

from __future__ import annotations

import time
from uuid import UUID

from app.schemas.tools import LeadSnapshot, LeadStateUpdate, ToolError
from app.tools.deps import AgentDeps
from app.tools.guards import ensure_can_write


async def get_lead(deps: AgentDeps, lead_id: str | None = None) -> LeadSnapshot | ToolError:
    started = time.perf_counter()
    target = lead_id or (str(deps.lead_id) if deps.lead_id else None)
    if target is None:
        deps.record("get_lead", ok=False, duration_ms=_ms(started), error_code="invalid_input")
        return ToolError(code="invalid_input", message="conversa sem lead associado")
    try:
        lead = await deps.leads.get(UUID(target))
    except ValueError:
        deps.record("get_lead", ok=False, duration_ms=_ms(started), error_code="invalid_input")
        return ToolError(code="invalid_input", message="lead_id não é um UUID")

    if lead is None:
        deps.record("get_lead", ok=False, duration_ms=_ms(started), error_code="not_found")
        return ToolError(code="not_found", message="lead não encontrado nesta empresa")

    deps.record("get_lead", ok=True, duration_ms=_ms(started))
    return lead


async def update_lead_state(
    deps: AgentDeps,
    *,
    detected_city: str | None = None,
    detected_state: str | None = None,
    detected_budget: str | None = None,
    detected_intent: str | None = None,
    purchase_timing: str | None = None,
    objections: list[str] | None = None,
) -> dict[str, int] | ToolError:
    """Grava o que foi observado neste turno.

    Campo omitido não apaga o valor anterior — ver
    `LeadRepository.update_state`.
    """
    started = time.perf_counter()
    if (blocked := ensure_can_write(deps, "update_lead_state")) is not None:
        deps.record(
            "update_lead_state",
            ok=False,
            duration_ms=_ms(started),
            error_code=blocked.code,
        )
        return blocked

    updated = await deps.leads.update_state(
        deps.conversation_id,
        LeadStateUpdate(
            detected_city=detected_city,
            detected_state=detected_state,
            detected_budget=detected_budget,
            detected_intent=detected_intent,
            purchase_timing=purchase_timing,
            objections=objections,
        ),
    )
    deps.record("update_lead_state", ok=True, duration_ms=_ms(started))
    return {"updated": updated}


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


__all__ = ["get_lead", "update_lead_state"]
