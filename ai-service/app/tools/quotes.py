"""Orçamentos.

Ação externa: um orçamento criado vira documento que o cliente recebe. Por
isso passa por `ensure_can_act` e carrega chave idempotente — o cenário que
isso previne é concreto: job reprocessado gerando dois orçamentos para o mesmo
lead, com dois números diferentes.

O INSERT em si não está escrito ainda, e isso é deliberado: eu **não auditei o
schema de `quotes`** nesta fase. O briefing foi explícito em não supor o que dá
para verificar no repositório — então a query fica para a FASE 8, depois de
mapear a tabela, e não um palpite que quebra em produção.
"""

from __future__ import annotations

import time
from decimal import Decimal
from uuid import UUID

from app.schemas.tools import QuoteCreated, QuoteDraft, ToolError
from app.tools.deps import AgentDeps
from app.tools.guards import ensure_can_act


async def create_quote(
    deps: AgentDeps,
    *,
    product_id: str,
    total: float,
    notes: str | None = None,
) -> QuoteCreated | ToolError:
    started = time.perf_counter()
    if (blocked := ensure_can_act(deps, "create_quote")) is not None:
        deps.record("create_quote", ok=False, duration_ms=_ms(started), error_code=blocked.code)
        return blocked

    if deps.lead_id is None:
        deps.record(
            "create_quote", ok=False, duration_ms=_ms(started), error_code="invalid_input"
        )
        return ToolError(code="invalid_input", message="conversa sem lead associado")

    try:
        draft = QuoteDraft(
            lead_id=deps.lead_id,
            product_id=UUID(product_id),
            total=Decimal(str(total)),
            notes=notes,
            idempotency_key=deps.action_key("create_quote"),
        )
    except (ValueError, ArithmeticError):
        deps.record(
            "create_quote", ok=False, duration_ms=_ms(started), error_code="invalid_input"
        )
        return ToolError(code="invalid_input", message="product_id ou total inválido")

    # O valor precisa bater com o catálogo. Orçamento com total inventado é a
    # mesma falha de alucinação de preço, só que registrada em documento.
    price = await deps.products.get_price(draft.product_id)
    if price is None:
        deps.record("create_quote", ok=False, duration_ms=_ms(started), error_code="not_found")
        return ToolError(code="not_found", message="produto não encontrado nesta empresa")

    # TODO(fase 8): INSERT em public.quotes com ON CONFLICT na idempotency_key.
    # Exige auditar o schema de `quotes` antes — não presumir colunas.
    deps.record("create_quote", ok=False, duration_ms=_ms(started), error_code="unavailable")
    return ToolError(code="unavailable", message="criação de orçamento chega na FASE 8")


async def get_quote(deps: AgentDeps, quote_id: str) -> ToolError:
    started = time.perf_counter()
    deps.record("get_quote", ok=False, duration_ms=_ms(started), error_code="unavailable")
    return ToolError(code="unavailable", message="leitura de orçamento chega na FASE 8")


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


__all__ = ["create_quote", "get_quote"]
