"""Guardas das ferramentas de escrita.

Toda tool que muda algo passa por `ensure_can_write` (interno) ou
`ensure_can_act` (externo) antes de qualquer efeito. A ordem — barreira física,
depois modo, depois humano — é a mesma do Policy Engine, e a duplicação é
intencional: o Policy Engine avalia a *decisão*; isto protege a *execução*.

Se alguém acoplar uma tool fora do workflow amanhã, ela continua barrada.
"""

from __future__ import annotations

from app.config import settings
from app.schemas.tools import ToolError
from app.tools.deps import AgentDeps


def ensure_can_write(deps: AgentDeps, tool: str) -> ToolError | None:
    """Escrita interna (banco da própria empresa, sem efeito externo)."""
    if not deps.execution.capabilities.can_write_internal:
        return ToolError(
            code="not_allowed_in_mode",
            message=f"{tool} indisponível no modo {deps.execution.mode}",
        )
    return None


def ensure_can_act(deps: AgentDeps, tool: str) -> ToolError | None:
    """Ação externa: mensagem, orçamento, visita, follow-up."""
    if not settings.allow_external_actions:
        return ToolError(
            code="not_allowed_in_mode",
            message=f"{tool} bloqueada: ALLOW_EXTERNAL_ACTIONS=false",
        )
    if not deps.execution.capabilities.can_act_externally:
        return ToolError(
            code="not_allowed_in_mode",
            message=f"{tool} indisponível no modo {deps.execution.mode}",
        )
    if deps.execution.human_active:
        return ToolError(code="forbidden", message="humano assumiu a conversa")
    return None


__all__ = ["ensure_can_act", "ensure_can_write"]
