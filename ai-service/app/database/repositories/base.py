"""Base dos repositories.

Toda subclasse recebe o `TenantScope` no construtor e o usa em **toda** query.
Não existe método sem escopo: se algum precisar, ele não pertence a este
pacote (vai para `jobs.py`, que é explicitamente cross-tenant).

O padrão de duas linhas em cada consulta — filtrar por `company_id` no SQL e
conferir com `scope.guard()` no resultado — é redundante de propósito. O SQL
pode mudar numa refatoração; o guard pega quando ele mudar errado.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import DictRow

from app.policies.tenant import TenantScope


class TenantRepository:
    def __init__(self, conn: AsyncConnection[DictRow], scope: TenantScope) -> None:
        self._conn = conn
        self._scope = scope

    @property
    def scope(self) -> TenantScope:
        return self._scope

    @property
    def company_id(self) -> UUID:
        return self._scope.company_id

    async def _fetch_all(self, sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
        async with self._conn.cursor() as cur:
            await cur.execute(sql, params)  # type: ignore[arg-type]
            rows = await cur.fetchall()
            return [dict(r) for r in rows]

    async def _fetch_one(self, sql: str, params: tuple[Any, ...]) -> dict[str, Any] | None:
        async with self._conn.cursor() as cur:
            await cur.execute(sql, params)  # type: ignore[arg-type]
            row = await cur.fetchone()
            return dict(row) if row else None

    async def _execute(self, sql: str, params: tuple[Any, ...]) -> int:
        async with self._conn.cursor() as cur:
            await cur.execute(sql, params)  # type: ignore[arg-type]
            return cur.rowcount

    def _guard_rows(self, rows: list[dict[str, Any]], what: str) -> list[dict[str, Any]]:
        """Confere company_id de cada linha antes de devolver."""
        for row in rows:
            self._scope.guard(row.get("company_id"), what)
        return rows

    def _guard_row(self, row: dict[str, Any] | None, what: str) -> dict[str, Any] | None:
        if row is not None:
            self._scope.guard(row.get("company_id"), what)
        return row


__all__ = ["TenantRepository"]
