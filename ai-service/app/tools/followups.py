"""Follow-up.

Diferença importante das outras ações externas: **o Atende Aí já tem um sistema
de follow-up funcionando** (`src/lib/followup/`), com gates, safety, regras
(`lead_silent`, `hot_lead_idle`) e pausa automática por taxa de resposta baixa
(`followup/gates.ts:64`).

O briefing foi claro: "follow-up atual não deve ser removido". Então esta
ferramenta **não cria um segundo motor de follow-up**. Ela enfileira no motor
existente. Se o Python criar follow-ups por fora, os gates de segurança do TS
deixam de valer — e é exatamente esse sistema que evita disparar mensagem para
quem já parou de responder.
"""

from __future__ import annotations

import time
from datetime import datetime

from app.schemas.tools import FollowupCreated, FollowupDraft, ToolError
from app.tools.deps import AgentDeps
from app.tools.guards import ensure_can_act

# Regras existentes em src/lib/followup/types.ts:10.
VALID_RULES = {"lead_silent", "hot_lead_idle"}


async def create_followup(
    deps: AgentDeps, *, run_at: str, rule: str = "lead_silent"
) -> FollowupCreated | ToolError:
    started = time.perf_counter()
    if (blocked := ensure_can_act(deps, "create_followup")) is not None:
        deps.record(
            "create_followup", ok=False, duration_ms=_ms(started), error_code=blocked.code
        )
        return blocked

    if rule not in VALID_RULES:
        deps.record(
            "create_followup", ok=False, duration_ms=_ms(started), error_code="invalid_input"
        )
        return ToolError(
            code="invalid_input",
            message=f"regra desconhecida; use uma de {sorted(VALID_RULES)}",
        )

    if deps.lead_id is None:
        deps.record(
            "create_followup", ok=False, duration_ms=_ms(started), error_code="invalid_input"
        )
        return ToolError(code="invalid_input", message="conversa sem lead associado")

    try:
        when = datetime.fromisoformat(run_at)
    except ValueError:
        deps.record(
            "create_followup", ok=False, duration_ms=_ms(started), error_code="invalid_input"
        )
        return ToolError(code="invalid_input", message="run_at inválido, use ISO 8601")

    _draft = FollowupDraft(
        lead_id=deps.lead_id,
        conversation_id=deps.conversation_id,
        run_at=when,
        rule=rule,
        idempotency_key=deps.action_key("create_followup"),
    )

    # TODO(fase 8): chamar o motor existente em vez de inserir direto.
    # Auditar antes como `src/lib/followup/` agenda, para respeitar os gates.
    deps.record("create_followup", ok=False, duration_ms=_ms(started), error_code="unavailable")
    return ToolError(code="unavailable", message="follow-up chega na FASE 8")


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


__all__ = ["VALID_RULES", "create_followup"]
