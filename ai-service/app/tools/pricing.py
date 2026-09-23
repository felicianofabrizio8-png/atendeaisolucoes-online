"""Preço — a ferramenta mais sensível do sistema.

Regra dura do briefing, implementada aqui: **o modelo nunca produz um preço**.
Ele pede; isto responde. Preço não cadastrado devolve `price = None`, e a
instrução do agente (`agents/sales_agent.py`) obriga a dizer que vai confirmar
com a equipe — não a estimar.

Por isso `ProductPrice.price` é `Decimal | None` e não string formatada: a
formatação em reais acontece na borda de saída, depois que o Policy Engine já
aprovou. Um preço que vira texto cedo demais é um preço que o modelo pode
reescrever no meio da frase.
"""

from __future__ import annotations

import time
from uuid import UUID

from app.schemas.tools import ProductPrice, ToolError
from app.tools.deps import AgentDeps


async def get_product_price(deps: AgentDeps, product_id: str) -> ProductPrice | ToolError:
    """Preço oficial do produto nesta empresa."""
    started = time.perf_counter()
    try:
        price = await deps.products.get_price(UUID(product_id))
    except ValueError:
        deps.record(
            "get_product_price",
            ok=False,
            duration_ms=_ms(started),
            error_code="invalid_input",
        )
        return ToolError(code="invalid_input", message="product_id não é um UUID")
    except Exception as err:
        deps.record(
            "get_product_price", ok=False, duration_ms=_ms(started), error_code="internal"
        )
        return ToolError(code="internal", message=str(err))

    if price is None:
        deps.record(
            "get_product_price", ok=False, duration_ms=_ms(started), error_code="not_found"
        )
        return ToolError(
            code="not_found",
            message="produto não encontrado nesta empresa",
        )

    deps.record("get_product_price", ok=True, duration_ms=_ms(started))
    return price


def format_brl(value: object) -> str:
    """Formata para exibição. Só usar depois do Policy Engine aprovar."""
    from decimal import Decimal

    if not isinstance(value, Decimal):
        return "—"
    inteiro, _, centavos = f"{value:.2f}".partition(".")
    grupos: list[str] = []
    while len(inteiro) > 3:
        grupos.insert(0, inteiro[-3:])
        inteiro = inteiro[:-3]
    grupos.insert(0, inteiro)
    return f"R$ {'.'.join(grupos)},{centavos}"


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


__all__ = ["format_brl", "get_product_price"]
