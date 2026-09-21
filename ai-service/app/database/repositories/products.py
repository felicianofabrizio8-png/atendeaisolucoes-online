"""Catálogo — fonte única de produto e preço.

Nenhum preço pode chegar ao cliente sem passar por aqui. É o coração da regra
anti-alucinação: o modelo pede, este repositório responde, e se não houver
preço cadastrado a resposta é `None` — não um texto que o modelo possa
reinterpretar.

Colunas conforme `products` usada em `sales-agent-grounding.server.ts:928-960`.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from app.database.repositories.base import TenantRepository
from app.schemas.tools import ProductDetail, ProductImages, ProductPrice, ProductSummary

_SUMMARY_COLS = """
    id, company_id, name, model, sku, category,
    length_m, width_m, depth_m, capacity_l, shape
"""

_DETAIL_COLS = (
    _SUMMARY_COLS
    + ", description, included_items, specifications, notes, images"
)


class ProductRepository(TenantRepository):
    async def search(
        self,
        query: str,
        *,
        category: str | None = None,
        min_length_m: float | None = None,
        max_length_m: float | None = None,
        limit: int = 5,
    ) -> tuple[list[ProductSummary], int]:
        """Busca textual no catálogo ativo da empresa.

        Usa FTS em português com fallback para ILIKE. O fallback importa mais
        do que parece: o catálogo tem SKU, modelo e medidas ("6x3"), e o
        stemmer de português não ajuda em nenhum desses — `websearch_to_tsquery`
        sozinho perde justamente as buscas mais frequentes.
        """
        sql = f"""
            SELECT {_SUMMARY_COLS},
                   COUNT(*) OVER () AS total_matched
              FROM public.products
             WHERE company_id = %s
               AND COALESCE(active, true) = true
               AND (
                    to_tsvector('portuguese',
                        COALESCE(name,'') || ' ' ||
                        COALESCE(model,'') || ' ' ||
                        COALESCE(category,'') || ' ' ||
                        COALESCE(description,'')
                    ) @@ websearch_to_tsquery('portuguese', %s)
                 OR name  ILIKE %s
                 OR model ILIKE %s
                 OR sku   ILIKE %s
               )
               AND (%s::text  IS NULL OR category = %s)
               AND (%s::float IS NULL OR length_m >= %s)
               AND (%s::float IS NULL OR length_m <= %s)
             ORDER BY name
             LIMIT %s
        """
        like = f"%{query}%"
        rows = await self._fetch_all(
            sql,
            (
                self.company_id,
                query,
                like,
                like,
                like,
                category,
                category,
                min_length_m,
                min_length_m,
                max_length_m,
                max_length_m,
                limit,
            ),
        )
        self._guard_rows(rows, "products.search")
        total = int(rows[0]["total_matched"]) if rows else 0
        return [ProductSummary.model_validate(r) for r in rows], total

    async def get(self, product_id: UUID) -> ProductDetail | None:
        sql = f"""
            SELECT {_DETAIL_COLS}
              FROM public.products
             WHERE company_id = %s AND id = %s
             LIMIT 1
        """
        row = await self._fetch_one(sql, (self.company_id, product_id))
        row = self._guard_row(row, "products.get")
        if row is None:
            return None
        return ProductDetail.model_validate(
            {
                **row,
                "included_items": _as_str_list(row.get("included_items")),
                "specifications": _as_dict(row.get("specifications")),
                "image_count": len(_as_str_list(row.get("images"))),
            }
        )

    async def get_price(self, product_id: UUID) -> ProductPrice | None:
        """Preço e promoção. Consulta dedicada porque preço é o dado mais
        sensível do sistema — carregá-lo junto com o resto convidaria a
        passear com ele pelo contexto sem necessidade."""
        sql = """
            SELECT id, company_id, price, promo_price
              FROM public.products
             WHERE company_id = %s AND id = %s
             LIMIT 1
        """
        row = await self._fetch_one(sql, (self.company_id, product_id))
        row = self._guard_row(row, "products.get_price")
        if row is None:
            return None
        return ProductPrice(
            product_id=row["id"],
            price=_as_decimal(row.get("price")),
            promo_price=_as_decimal(row.get("promo_price")),
        )

    async def get_images(self, product_id: UUID) -> ProductImages | None:
        sql = """
            SELECT id, company_id, images
              FROM public.products
             WHERE company_id = %s AND id = %s
             LIMIT 1
        """
        row = await self._fetch_one(sql, (self.company_id, product_id))
        row = self._guard_row(row, "products.get_images")
        if row is None:
            return None
        return ProductImages(product_id=row["id"], image_ids=_as_str_list(row.get("images")))

    async def count_active(self) -> int:
        row = await self._fetch_one(
            """
            SELECT COUNT(*) AS n
              FROM public.products
             WHERE company_id = %s AND COALESCE(active, true) = true
            """,
            (self.company_id,),
        )
        return int(row["n"]) if row else 0


def _as_str_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [v for v in value if isinstance(v, str)]
    return []


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except Exception:
        return None


__all__ = ["ProductRepository"]
