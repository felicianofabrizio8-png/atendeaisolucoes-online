"""Fixtures e dublês.

Os testes desta suíte rodam SEM banco. Um `FakeConnection` devolve linhas
prontas, o que permite testar a coisa que mais importa — o comportamento dos
guards de tenant — sem depender de Postgres no CI.

Os testes que precisam de banco de verdade ficam marcados com `@pytest.mark.db`
e não rodam por padrão.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

import pytest

from app.policies.execution import CompanyFlags, ExecutionContext
from app.policies.tenant import TenantScope

COMPANY_A = UUID("11111111-1111-1111-1111-111111111111")
COMPANY_B = UUID("22222222-2222-2222-2222-222222222222")


class FakeCursor:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows
        self.rowcount = len(rows)
        self.executed: list[tuple[str, tuple[Any, ...]]] = []

    async def execute(self, sql: str, params: tuple[Any, ...] = ()) -> None:
        self.executed.append((sql, params))

    async def executemany(self, sql: str, rows: list[tuple[Any, ...]]) -> None:
        self.executed.append((sql, tuple(rows)))

    async def fetchall(self) -> list[dict[str, Any]]:
        return self._rows

    async def fetchone(self) -> dict[str, Any] | None:
        return self._rows[0] if self._rows else None

    async def __aenter__(self) -> FakeCursor:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None


class FakeConnection:
    """Conexão que devolve sempre as mesmas linhas.

    Serve para o caso perigoso: o banco devolveu linha de OUTRA empresa (filtro
    errado, RLS desligada, bug de query). O guard tem que pegar.

    O cursor é reaproveitado entre chamadas para que `executed` acumule o SQL
    de todas elas — é o que permite ao teste verificar que o filtro por
    `company_id` está mesmo na query, e não só no guard.
    """

    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self.rows = rows or []
        self._cursor = FakeCursor(self.rows)

    def cursor(self) -> FakeCursor:
        return self._cursor

    @property
    def executed(self) -> list[tuple[str, tuple[Any, ...]]]:
        return self._cursor.executed


@pytest.fixture
def scope_a() -> TenantScope:
    return TenantScope(company_id=COMPANY_A, correlation_id="test-a")


@pytest.fixture
def scope_b() -> TenantScope:
    return TenantScope(company_id=COMPANY_B, correlation_id="test-b")


@pytest.fixture
def execution_silent(scope_a: TenantScope) -> ExecutionContext:
    return ExecutionContext(
        scope=scope_a,
        conversation_id=uuid4(),
        mode="silent",
        flags=CompanyFlags(),
    )


@pytest.fixture
def execution_automatic(scope_a: TenantScope) -> ExecutionContext:
    return ExecutionContext(
        scope=scope_a,
        conversation_id=uuid4(),
        mode="automatic",
        flags=CompanyFlags(python_ai_enabled=True, python_ai_automatic_mode=True),
    )


def product_row(company_id: UUID, **overrides: Any) -> dict[str, Any]:
    base = {
        "id": uuid4(),
        "company_id": company_id,
        "name": "Piscina 6x3",
        "model": "P63",
        "sku": "SKU-63",
        "category": "fibra",
        "length_m": 6.0,
        "width_m": 3.0,
        "depth_m": 1.4,
        "capacity_l": 20000.0,
        "shape": "retangular",
        "price": 28000,
        "promo_price": None,
        "images": [],
        "description": None,
        "included_items": [],
        "specifications": {},
        "notes": None,
        "total_matched": 1,
    }
    return {**base, **overrides}


__all__ = [
    "COMPANY_A",
    "COMPANY_B",
    "FakeConnection",
    "FakeCursor",
    "product_row",
]
