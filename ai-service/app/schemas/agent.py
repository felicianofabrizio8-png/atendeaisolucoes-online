"""Contratos do agente: entrada do turno, decisão estruturada e resultado.

A decisão é um modelo Pydantic, não texto livre. O agente TS atual já extrai
campos via tool-call de turno único (`sales-agent-core.ts`), mas o parsing
mora espalhado; aqui o contrato é explícito e validado.

Vocabulário: o domínio interno é em inglês (como especificado), enquanto o
banco guarda valores em português (`lead_temperature = 'quente'`,
`ai_status = 'assumido_humano'`). A tradução acontece SÓ na borda dos
repositories — ver `database/repositories/conversations.py`. Nenhuma outra
camada deve conhecer os dois vocabulários.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

AgentAction = Literal[
    "reply",
    "handoff",
    "ask_question",
    "create_quote",
    "schedule_visit",
    "followup",
    "skip",
]

LeadTemperature = Literal["cold", "warm", "hot"]

# Espelha o CHECK de `conversation_sales_states.scope_type`.
ScopeType = Literal["training_session", "whatsapp_conversation"]


class ConversationMessage(BaseModel):
    """Uma mensagem do histórico, já normalizada."""

    model_config = ConfigDict(frozen=True)

    role: Literal["lead", "agent", "system"]
    text: str
    created_at: datetime | None = None
    product_ids: list[UUID] = Field(default_factory=list)


class SalesTurnRequest(BaseModel):
    """Entrada de um turno.

    `company_id` NUNCA vem do cliente HTTP: é derivado do job ou da conversa no
    servidor. O campo existe aqui porque o worker o preenche depois de ler o
    job — ver `api/deps.py`, que rejeita o campo quando vem do corpo.
    """

    company_id: UUID
    conversation_id: UUID
    lead_id: UUID | None = None
    scope_type: ScopeType = "whatsapp_conversation"

    # Quando ausente, o workflow carrega do banco. Preencher é útil em teste.
    history: list[ConversationMessage] | None = None
    lead_name: str | None = None

    # Idempotência ponta a ponta: mesma chave = mesmo efeito externo, uma vez.
    idempotency_key: str | None = None
    correlation_id: str | None = None


class ToolInvocation(BaseModel):
    """Registro de uma chamada de ferramenta dentro do turno."""

    model_config = ConfigDict(frozen=True)

    name: str
    ok: bool
    duration_ms: int
    error_code: str | None = None


class AgentDecision(BaseModel):
    """Saída estruturada do Sales Agent.

    Esta é a fronteira entre "o modelo pensou" e "o sistema age". O Policy
    Engine recebe exatamente este objeto e decide o que pode ser executado —
    o agente não executa nada por conta própria.
    """

    action: AgentAction
    message: str | None = None

    intent: str | None = None
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    lead_temperature: LeadTemperature | None = None
    objections: list[str] = Field(default_factory=list)

    current_product_id: UUID | None = None
    suggested_product_ids: list[UUID] = Field(default_factory=list)

    next_action: str | None = None

    # Preenchido pelo workflow, não pelo modelo: é evidência de aterramento.
    tool_calls_used: list[str] = Field(default_factory=list)
    grounding_sources: list[str] = Field(default_factory=list)

    requires_human_approval: bool = False
    reason: str | None = None

    def mentions_external_action(self) -> bool:
        """Ações que tocam o mundo fora do banco de leitura."""
        return self.action in {"reply", "create_quote", "schedule_visit", "followup"}


class SalesTurnResult(BaseModel):
    """O que o turno devolve, já depois do Policy Engine."""

    decision: AgentDecision
    execution_mode: Literal["silent", "assisted", "automatic"]
    executed: bool
    blocked_reason: str | None = None
    suggestion_id: UUID | None = None
    trace_id: str | None = None
    latency_ms: int = 0


__all__ = [
    "AgentAction",
    "AgentDecision",
    "ConversationMessage",
    "LeadTemperature",
    "SalesTurnRequest",
    "SalesTurnResult",
    "ScopeType",
    "ToolInvocation",
]
