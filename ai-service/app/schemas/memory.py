"""Contratos das três memórias.

Working memory é o caso mais delicado: hoje ela está partida entre
`conversation_sales_states` (produto/intenção) e colunas de `conversations`
(qualificação). Ver auditoria §3.2. Este módulo expõe um modelo único; quem
remonta a partir das duas fontes é `memory/working.py`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

MemoryType = Literal[
    "preference",
    "objection",
    "constraint",
    "commitment",
    "fact",
    "timing",
]

MemorySource = Literal["agent_inferred", "human_confirmed", "system_event"]


class WorkingMemory(BaseModel):
    """Estado da conversa atual.

    Serve para o agente entender "sim", "esse", "o segundo", "quanto fica?"
    sem reenviar o histórico inteiro ao modelo.
    """

    company_id: UUID
    scope_type: Literal["training_session", "whatsapp_conversation"]
    scope_id: UUID

    intent: str | None = None
    stage: str | None = None

    current_product_id: UUID | None = None
    candidate_product_ids: list[UUID] = Field(default_factory=list)
    # Último conjunto que passou por validação de catálogo. É o que responde
    # a "esse mesmo" quando a última busca não achou nada.
    last_valid_product_ids: list[UUID] = Field(default_factory=list)

    budget: str | None = None
    city: str | None = None
    state: str | None = None
    purchase_timing: str | None = None
    objections: list[str] = Field(default_factory=list)

    last_question: str | None = None
    pending_action: str | None = None
    missing_information: list[str] = Field(default_factory=list)

    updated_at: datetime | None = None

    def resolve_referenced_product(self, ordinal: int | None = None) -> UUID | None:
        """Resolve referência anafórica ("esse", "o segundo").

        Sem ordinal: o produto corrente, ou o único candidato se não houver
        ambiguidade. Com ordinal (1-based): o n-ésimo candidato.
        Devolve None quando a referência é ambígua — e aí o agente pergunta,
        em vez de chutar.
        """
        pool = self.candidate_product_ids or self.last_valid_product_ids
        if ordinal is not None:
            idx = ordinal - 1
            return pool[idx] if 0 <= idx < len(pool) else None
        if self.current_product_id is not None:
            return self.current_product_id
        return pool[0] if len(pool) == 1 else None


class EpisodicMemory(BaseModel):
    """Fato específico daquele lead, aprendido na conversa."""

    model_config = ConfigDict(frozen=True)

    id: UUID | None = None
    company_id: UUID
    lead_id: UUID
    conversation_id: UUID | None = None

    memory_type: MemoryType
    content: str = Field(min_length=1, max_length=1000)
    confidence: float = Field(ge=0.0, le=1.0)
    source: MemorySource

    created_at: datetime | None = None
    expires_at: datetime | None = None

    def is_valid_at(self, moment: datetime) -> bool:
        return self.expires_at is None or self.expires_at > moment


class SemanticDocument(BaseModel):
    """Conhecimento oficial da empresa, candidato a virar chunks indexados."""

    id: UUID | None = None
    company_id: UUID
    source_type: str
    source_id: UUID | None = None
    title: str | None = None
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class ConversationSummary(BaseModel):
    """Resumo incremental: `summary` anterior + novas mensagens = novo summary.
    `covered_until` evita re-resumir o que já entrou."""

    company_id: UUID
    conversation_id: UUID
    summary: str
    covered_until: datetime
    message_count: int = 0


__all__ = [
    "ConversationSummary",
    "EpisodicMemory",
    "MemorySource",
    "MemoryType",
    "SemanticDocument",
    "WorkingMemory",
]
