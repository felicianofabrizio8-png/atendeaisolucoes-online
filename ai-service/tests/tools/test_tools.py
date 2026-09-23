"""Ferramentas: guardas de modo, erros tratados e formatação de preço."""

from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest

from app.config import settings
from app.policies.execution import CompanyFlags, ExecutionContext
from app.policies.tenant import TenantScope
from app.schemas.tools import ToolError
from app.tools import catalog, messaging, pricing, quotes
from app.tools.deps import AgentDeps
from app.tools.guards import ensure_can_act, ensure_can_write
from tests.conftest import COMPANY_A, FakeConnection, product_row


def _deps(mode: str, conn: FakeConnection | None = None) -> AgentDeps:
    from app.database.repositories.chunks import ChunkRepository
    from app.database.repositories.conversations import ConversationRepository
    from app.database.repositories.knowledge import KnowledgeRepository
    from app.database.repositories.leads import LeadRepository
    from app.database.repositories.memory import MemoryRepository
    from app.database.repositories.products import ProductRepository
    from app.retrieval.embeddings import get_embedding_provider
    from app.retrieval.reranker import get_reranker

    scope = TenantScope(company_id=COMPANY_A)
    conn = conn or FakeConnection([])
    conversation_id = uuid4()
    return AgentDeps(
        scope=scope,
        execution=ExecutionContext(
            scope=scope,
            conversation_id=conversation_id,
            mode=mode,  # type: ignore[arg-type]
            flags=CompanyFlags(),
        ),
        conversation_id=conversation_id,
        lead_id=uuid4(),
        products=ProductRepository(conn, scope),  # type: ignore[arg-type]
        leads=LeadRepository(conn, scope),  # type: ignore[arg-type]
        conversations=ConversationRepository(conn, scope),  # type: ignore[arg-type]
        knowledge=KnowledgeRepository(conn, scope),  # type: ignore[arg-type]
        memory=MemoryRepository(conn, scope),  # type: ignore[arg-type]
        chunks=ChunkRepository(conn, scope),  # type: ignore[arg-type]
        embeddings=get_embedding_provider(),
        reranker=get_reranker(),
        idempotency_base="turno-1",
    )


class TestGuardas:
    def test_silent_bloqueia_escrita_interna(self) -> None:
        assert ensure_can_write(_deps("silent"), "x") is not None

    def test_assisted_permite_escrita_interna(self) -> None:
        assert ensure_can_write(_deps("assisted"), "x") is None

    def test_barreira_fisica_bloqueia_acao_externa(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "allow_external_actions", False)
        assert ensure_can_act(_deps("automatic"), "send_message") is not None

    def test_automatic_com_barreira_aberta_permite(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "allow_external_actions", True)
        assert ensure_can_act(_deps("automatic"), "send_message") is None


class TestFerramentasDeLeitura:
    async def test_busca_registra_invocacao(self) -> None:
        """O rastro de ferramentas vira `tool_calls_used` na decisão e é a
        evidência de aterramento que os evals medem."""
        deps = _deps("silent", FakeConnection([product_row(COMPANY_A)]))
        result = await catalog.search_catalog(deps, "piscina")
        assert not isinstance(result, ToolError)
        assert "search_catalog" in deps.tool_names()

    async def test_produto_inexistente_vira_erro_tratado(self) -> None:
        """Ferramenta não levanta exceção para o agente: devolve ToolError."""
        deps = _deps("silent", FakeConnection([]))
        result = await catalog.get_product(deps, str(uuid4()))
        assert isinstance(result, ToolError)
        assert result.code == "not_found"

    async def test_uuid_invalido(self) -> None:
        deps = _deps("silent")
        result = await catalog.get_product(deps, "não-é-uuid")
        assert isinstance(result, ToolError)
        assert result.code == "invalid_input"

    async def test_ambiguidade_sinalizada(self) -> None:
        """Muitos resultados: o agente deve perguntar, não escolher."""
        rows = [product_row(COMPANY_A, total_matched=5) for _ in range(5)]
        deps = _deps("silent", FakeConnection(rows))
        result = await catalog.search_catalog(deps, "piscina")
        assert not isinstance(result, ToolError)
        assert result.ambiguous

    async def test_preco_de_produto_inexistente(self) -> None:
        deps = _deps("silent", FakeConnection([]))
        result = await pricing.get_product_price(deps, str(uuid4()))
        assert isinstance(result, ToolError)
        assert result.code == "not_found"


class TestAcoesExternas:
    async def test_envio_bloqueado_por_padrao(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "allow_external_actions", False)
        result = await messaging.send_message(_deps("automatic"), "olá")
        assert isinstance(result, ToolError)
        assert result.code == "not_allowed_in_mode"

    async def test_handoff_funciona_em_silent(self) -> None:
        """Handoff é o caminho seguro e vale em qualquer modo."""
        result = await messaging.human_handoff(_deps("silent"), "cliente pediu humano")
        assert not isinstance(result, ToolError)

    async def test_orcamento_bloqueado_em_silent(self) -> None:
        result = await quotes.create_quote(
            _deps("silent"), product_id=str(uuid4()), total=1000.0
        )
        assert isinstance(result, ToolError)


class TestIdempotencia:
    def test_chave_por_acao(self) -> None:
        deps = _deps("automatic")
        assert deps.action_key("send_message") != deps.action_key("create_quote")

    def test_chave_estavel_no_turno(self) -> None:
        """Mesma base, mesma chave: é o que impede o reprocessamento de um job
        gerar dois orçamentos."""
        deps = _deps("automatic")
        assert deps.action_key("create_quote") == deps.action_key("create_quote")


class TestFormatacao:
    @pytest.mark.parametrize(
        ("valor", "esperado"),
        [
            (Decimal("28000"), "R$ 28.000,00"),
            (Decimal("1234567.89"), "R$ 1.234.567,89"),
            (Decimal("0.5"), "R$ 0,50"),
        ],
    )
    def test_formato_brl(self, valor: Decimal, esperado: str) -> None:
        assert pricing.format_brl(valor) == esperado

    def test_valor_ausente(self) -> None:
        assert pricing.format_brl(None) == "—"
