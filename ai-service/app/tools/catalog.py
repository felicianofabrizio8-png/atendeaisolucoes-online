"""Ferramentas de catálogo.

Substituem a injeção do catálogo inteiro no prompt, que é o que o agente TS faz
hoje (`sales-agent-grounding.server.ts:895`). A diferença prática: o modelo
passa a **pedir** o produto em vez de escolher dentro de uma lista já colada no
contexto — e o que ele não pediu, ele não tem como citar.
"""

from __future__ import annotations

import time

from app.schemas.tools import (
    CatalogSearchResult,
    ProductDetail,
    ProductImages,
    ToolError,
)
from app.tools.deps import AgentDeps

# Acima disso a lista é ambígua demais para o agente escolher sozinho: ele
# deve perguntar, não chutar.
AMBIGUITY_THRESHOLD = 3


async def search_catalog(
    deps: AgentDeps,
    query: str,
    *,
    category: str | None = None,
    min_length_m: float | None = None,
    max_length_m: float | None = None,
    limit: int = 5,
) -> CatalogSearchResult | ToolError:
    """Busca produtos ativos da empresa."""
    started = time.perf_counter()
    try:
        products, total = await deps.products.search(
            query,
            category=category,
            min_length_m=min_length_m,
            max_length_m=max_length_m,
            limit=limit,
        )
        result = CatalogSearchResult(
            products=products,
            total_matched=total,
            ambiguous=len(products) > AMBIGUITY_THRESHOLD,
        )
        deps.record(
            "search_catalog", ok=True, duration_ms=_ms(started)
        )
        return result
    except Exception as err:
        deps.record("search_catalog", ok=False, duration_ms=_ms(started), error_code="internal")
        return ToolError(code="internal", message=f"falha ao buscar catálogo: {err}")


async def get_product(deps: AgentDeps, product_id: str) -> ProductDetail | ToolError:
    """Detalhe de um produto."""
    started = time.perf_counter()
    try:
        from uuid import UUID

        product = await deps.products.get(UUID(product_id))
        if product is None:
            deps.record(
                "get_product", ok=False, duration_ms=_ms(started), error_code="not_found"
            )
            return ToolError(code="not_found", message="produto não encontrado nesta empresa")
        deps.record("get_product", ok=True, duration_ms=_ms(started))
        return product
    except ValueError:
        deps.record(
            "get_product", ok=False, duration_ms=_ms(started), error_code="invalid_input"
        )
        return ToolError(code="invalid_input", message="product_id não é um UUID")
    except Exception as err:
        deps.record("get_product", ok=False, duration_ms=_ms(started), error_code="internal")
        return ToolError(code="internal", message=str(err))


async def get_product_images(deps: AgentDeps, product_id: str) -> ProductImages | ToolError:
    """IDs das imagens cadastradas.

    Devolve ID, nunca URL: quem resolve URL assinada é o plano de integração
    em TS. Uma URL no contexto do modelo é uma URL que ele pode reescrever.
    """
    started = time.perf_counter()
    try:
        from uuid import UUID

        images = await deps.products.get_images(UUID(product_id))
        if images is None:
            deps.record(
                "get_product_images", ok=False, duration_ms=_ms(started), error_code="not_found"
            )
            return ToolError(code="not_found", message="produto não encontrado")
        deps.record("get_product_images", ok=True, duration_ms=_ms(started))
        return images
    except ValueError:
        deps.record(
            "get_product_images",
            ok=False,
            duration_ms=_ms(started),
            error_code="invalid_input",
        )
        return ToolError(code="invalid_input", message="product_id não é um UUID")


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


__all__ = ["AMBIGUITY_THRESHOLD", "get_product", "get_product_images", "search_catalog"]
