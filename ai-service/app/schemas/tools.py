"""Entradas e saídas tipadas das ferramentas.

Regra anti-alucinação: todo fato comercial que sai numa resposta precisa ter
vindo de um destes modelos. O modelo de linguagem pode decidir *que* precisa do
preço; ele não pode produzir o número.

Por isso `ProductPrice.price` é `Decimal | None` e não `str`: um preço ausente
tem que ser tratado como ausente, nunca virar texto que o modelo possa
reescrever.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ToolError(BaseModel):
    """Erro tratado. Ferramenta não levanta exceção para o agente: devolve isto,
    e o agente decide o que fazer (normalmente: handoff)."""

    model_config = ConfigDict(frozen=True)

    code: Literal[
        "not_found",
        "forbidden",
        "invalid_input",
        "unavailable",
        "not_allowed_in_mode",
        "rate_limited",
        "internal",
    ]
    message: str


# --------------------------------------------------------------------------
# Catálogo
# --------------------------------------------------------------------------
class ProductSummary(BaseModel):
    """Versão enxuta para listagem. Sem `description` e sem `specifications`:
    o catálogo inteiro no prompt é justamente o que queremos parar de fazer."""

    model_config = ConfigDict(frozen=True)

    id: UUID
    name: str
    model: str | None = None
    sku: str | None = None
    category: str | None = None
    length_m: float | None = None
    width_m: float | None = None
    depth_m: float | None = None
    capacity_l: float | None = None
    shape: str | None = None


class ProductDetail(ProductSummary):
    description: str | None = None
    included_items: list[str] = Field(default_factory=list)
    specifications: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = None
    image_count: int = 0


class CatalogSearchInput(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    category: str | None = None
    min_length_m: float | None = None
    max_length_m: float | None = None
    limit: int = Field(default=5, ge=1, le=20)


class CatalogSearchResult(BaseModel):
    products: list[ProductSummary] = Field(default_factory=list)
    total_matched: int = 0
    # `ambiguous` existe para o agente perguntar em vez de escolher sozinho.
    ambiguous: bool = False


class ProductPrice(BaseModel):
    model_config = ConfigDict(frozen=True)

    product_id: UUID
    price: Decimal | None
    promo_price: Decimal | None
    currency: str = "BRL"

    @property
    def effective(self) -> Decimal | None:
        return self.promo_price if self.promo_price is not None else self.price


class ProductImages(BaseModel):
    product_id: UUID
    # IDs/URLs internas. O agente referencia por ID; quem resolve URL é o
    # plano de integração em TS, não o modelo.
    image_ids: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------
# Conhecimento e políticas
# --------------------------------------------------------------------------
class KnowledgeHit(BaseModel):
    model_config = ConfigDict(frozen=True)

    chunk_id: UUID
    document_id: UUID | None
    content: str
    source_type: str
    score: float
    metadata: dict[str, Any] = Field(default_factory=dict)


class KnowledgeSearchInput(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    source_types: list[str] | None = None
    limit: int = Field(default=5, ge=1, le=20)


class KnowledgeSearchResult(BaseModel):
    hits: list[KnowledgeHit] = Field(default_factory=list)


class CommercialPolicy(BaseModel):
    """Espelha `marketing_knowledge_base`. Campos nulos significam
    "não cadastrado" — e o agente deve dizer que não sabe, não inventar."""

    model_config = ConfigDict(frozen=True)

    commercial_terms: str | None = None
    payment_policy: str | None = None
    installation_policy: str | None = None
    visit_policy: str | None = None
    heating_policy: str | None = None
    shipping_policy: str | None = None
    included_items_policy: str | None = None


# --------------------------------------------------------------------------
# Lead / CRM
# --------------------------------------------------------------------------
class LeadSnapshot(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    name: str | None = None
    status: str | None = None
    product_id: UUID | None = None
    estimated_value: Decimal | None = None
    created_at: datetime | None = None


class LeadStateUpdate(BaseModel):
    """Só campos que a IA tem direito de mexer. `status` fica de fora de
    propósito: mudança de funil é ação comercial, passa por policy."""

    detected_city: str | None = None
    detected_state: str | None = None
    detected_budget: str | None = None
    detected_intent: str | None = None
    purchase_timing: str | None = None
    objections: list[str] | None = None


# --------------------------------------------------------------------------
# Ações externas (escrita)
# --------------------------------------------------------------------------
class QuoteDraft(BaseModel):
    lead_id: UUID
    product_id: UUID
    total: Decimal
    notes: str | None = None
    idempotency_key: str


class QuoteCreated(BaseModel):
    quote_id: UUID
    created: bool  # false = já existia (idempotência funcionou)


class VisitDraft(BaseModel):
    lead_id: UUID
    scheduled_for: date
    notes: str | None = None
    idempotency_key: str


class VisitScheduled(BaseModel):
    visit_id: UUID
    created: bool


class FollowupDraft(BaseModel):
    lead_id: UUID
    conversation_id: UUID
    run_at: datetime
    rule: str
    idempotency_key: str


class FollowupCreated(BaseModel):
    followup_id: UUID
    created: bool


class OutboundMessage(BaseModel):
    conversation_id: UUID
    text: str = Field(min_length=1, max_length=4000)
    idempotency_key: str


class MessageSent(BaseModel):
    message_id: UUID | None
    sent: bool
    reason: str | None = None


class HandoffRequest(BaseModel):
    conversation_id: UUID
    reason: str = Field(min_length=1, max_length=500)


__all__ = [
    "CatalogSearchInput",
    "CatalogSearchResult",
    "CommercialPolicy",
    "FollowupCreated",
    "FollowupDraft",
    "HandoffRequest",
    "KnowledgeHit",
    "KnowledgeSearchInput",
    "KnowledgeSearchResult",
    "LeadSnapshot",
    "LeadStateUpdate",
    "MessageSent",
    "OutboundMessage",
    "ProductDetail",
    "ProductImages",
    "ProductPrice",
    "ProductSummary",
    "QuoteCreated",
    "QuoteDraft",
    "ToolError",
    "VisitDraft",
    "VisitScheduled",
]
