"""Isolamento multi-tenant.

Estes são os testes mais importantes do projeto. O cenário que eles cobrem não
é hipotético: o plano server-side não é protegido por RLS hoje (auditoria §5),
então um filtro errado numa query devolve dado de outra empresa **sem erro
nenhum**.

A pergunta que cada teste responde: "se o banco devolver linha da empresa
errada, o código percebe?"
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.database.repositories.conversations import ConversationRepository
from app.database.repositories.products import ProductRepository
from app.policies.tenant import TenantScope, TenantViolationError
from tests.conftest import COMPANY_A, COMPANY_B, FakeConnection, product_row


class TestTenantScope:
    def test_guard_aceita_mesma_empresa(self, scope_a: TenantScope) -> None:
        scope_a.guard(COMPANY_A, "teste")

    def test_guard_rejeita_outra_empresa(self, scope_a: TenantScope) -> None:
        with pytest.raises(TenantViolationError) as err:
            scope_a.guard(COMPANY_B, "teste")
        assert err.value.expected == COMPANY_A
        assert err.value.received == COMPANY_B

    def test_guard_rejeita_none(self, scope_a: TenantScope) -> None:
        """Linha sem company_id é tão suspeita quanto linha de outra empresa."""
        with pytest.raises(TenantViolationError):
            scope_a.guard(None, "teste")

    def test_escopo_e_imutavel(self, scope_a: TenantScope) -> None:
        with pytest.raises(AttributeError):
            scope_a.company_id = COMPANY_B  # type: ignore[misc]


class TestProdutoCrossTenant:
    async def test_busca_detecta_linha_de_outra_empresa(
        self, scope_a: TenantScope
    ) -> None:
        """Banco devolveu produto da empresa B para um escopo da empresa A."""
        conn = FakeConnection([product_row(COMPANY_B)])
        repo = ProductRepository(conn, scope_a)  # type: ignore[arg-type]

        with pytest.raises(TenantViolationError):
            await repo.search("piscina")

    async def test_get_detecta_linha_de_outra_empresa(
        self, scope_a: TenantScope
    ) -> None:
        conn = FakeConnection([product_row(COMPANY_B)])
        repo = ProductRepository(conn, scope_a)  # type: ignore[arg-type]

        with pytest.raises(TenantViolationError):
            await repo.get(uuid4())

    async def test_preco_detecta_linha_de_outra_empresa(
        self, scope_a: TenantScope
    ) -> None:
        """O caso mais grave: preço de outra empresa virando resposta."""
        conn = FakeConnection([{"id": uuid4(), "company_id": COMPANY_B, "price": 1, "promo_price": None}])
        repo = ProductRepository(conn, scope_a)  # type: ignore[arg-type]

        with pytest.raises(TenantViolationError):
            await repo.get_price(uuid4())

    async def test_busca_aceita_propria_empresa(self, scope_a: TenantScope) -> None:
        conn = FakeConnection([product_row(COMPANY_A)])
        repo = ProductRepository(conn, scope_a)  # type: ignore[arg-type]

        produtos, total = await repo.search("piscina")
        assert total == 1
        assert produtos[0].name == "Piscina 6x3"

    @pytest.mark.parametrize(
        "operacao",
        ["search", "get", "get_price", "get_images"],
    )
    async def test_toda_query_filtra_por_company_id(
        self, scope_a: TenantScope, operacao: str
    ) -> None:
        """O filtro precisa estar no SQL, não só no guard.

        Se alguém remover o WHERE numa refatoração, o guard ainda pega — mas
        só depois de o banco ter lido e transmitido a linha. Os dois precisam
        existir, e este teste cobre o primeiro.
        """
        conn = FakeConnection([product_row(COMPANY_A)])
        repo = ProductRepository(conn, scope_a)  # type: ignore[arg-type]

        if operacao == "search":
            await repo.search("piscina")
        elif operacao == "get":
            await repo.get(uuid4())
        elif operacao == "get_price":
            await repo.get_price(uuid4())
        else:
            await repo.get_images(uuid4())

        assert conn.executed, "nenhuma query executada"
        sql, params = conn.executed[-1]
        assert "company_id = %s" in sql, f"{operacao} não filtra por company_id"
        assert COMPANY_A in params, f"{operacao} não passa o company_id do escopo"

    async def test_conversa_de_outra_empresa(self, scope_a: TenantScope) -> None:
        conn = FakeConnection([{"id": uuid4(), "company_id": COMPANY_B, "lead_id": uuid4()}])
        repo = ConversationRepository(conn, scope_a)  # type: ignore[arg-type]

        with pytest.raises(TenantViolationError):
            await repo.get(uuid4())

    async def test_mensagens_de_outra_empresa(self, scope_a: TenantScope) -> None:
        conn = FakeConnection(
            [{"id": uuid4(), "company_id": COMPANY_B, "direction": "inbound", "content": "oi"}]
        )
        repo = ConversationRepository(conn, scope_a)  # type: ignore[arg-type]

        with pytest.raises(TenantViolationError):
            await repo.recent_messages(uuid4())
