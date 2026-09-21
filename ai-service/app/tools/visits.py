"""Agendamento de visita.

Mesma situação de `quotes.py`: ação externa, guarda e idempotência prontas, o
INSERT esperando a FASE 8 porque o schema de agenda não foi auditado nesta
fase. Uma visita agendada duas vezes vira dois compromissos na agenda de
alguém — o tipo de bug que só aparece depois, com cliente na porta.
"""

from __future__ import annotations

import time
from datetime import date

from app.schemas.tools import ToolError, VisitDraft, VisitScheduled
from app.tools.deps import AgentDeps
from app.tools.guards import ensure_can_act


async def schedule_visit(
    deps: AgentDeps, *, scheduled_for: str, notes: str | None = None
) -> VisitScheduled | ToolError:
    """Agenda visita técnica/comercial. Data em ISO (YYYY-MM-DD)."""
    started = time.perf_counter()
    if (blocked := ensure_can_act(deps, "schedule_visit")) is not None:
        deps.record(
            "schedule_visit", ok=False, duration_ms=_ms(started), error_code=blocked.code
        )
        return blocked

    if deps.lead_id is None:
        deps.record(
            "schedule_visit", ok=False, duration_ms=_ms(started), error_code="invalid_input"
        )
        return ToolError(code="invalid_input", message="conversa sem lead associado")

    try:
        when = date.fromisoformat(scheduled_for)
    except ValueError:
        deps.record(
            "schedule_visit", ok=False, duration_ms=_ms(started), error_code="invalid_input"
        )
        return ToolError(code="invalid_input", message="data inválida, use YYYY-MM-DD")

    if when < date.today():
        deps.record(
            "schedule_visit", ok=False, duration_ms=_ms(started), error_code="invalid_input"
        )
        return ToolError(code="invalid_input", message="data no passado")

    _draft = VisitDraft(
        lead_id=deps.lead_id,
        scheduled_for=when,
        notes=notes,
        idempotency_key=deps.action_key("schedule_visit"),
    )

    # TODO(fase 8): persistir na agenda. Auditar o schema antes de escrever SQL.
    deps.record("schedule_visit", ok=False, duration_ms=_ms(started), error_code="unavailable")
    return ToolError(code="unavailable", message="agendamento chega na FASE 8")


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


__all__ = ["schedule_visit"]
