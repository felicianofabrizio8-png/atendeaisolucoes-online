"""Working memory — resolução de referência e expiração episódica.

O que estes testes protegem é a experiência concreta do atendimento: o cliente
escreve "esse mesmo" e o sistema precisa saber de qual produto ele fala, sem
reenviar o histórico inteiro ao modelo.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.memory import episodic
from app.schemas.memory import EpisodicMemory, WorkingMemory
from tests.conftest import COMPANY_A

P1, P2, P3 = uuid4(), uuid4(), uuid4()


def _wm(**kwargs: object) -> WorkingMemory:
    base = {
        "company_id": COMPANY_A,
        "scope_type": "whatsapp_conversation",
        "scope_id": uuid4(),
    }
    return WorkingMemory(**{**base, **kwargs})  # type: ignore[arg-type]


class TestResolucaoDeReferencia:
    def test_produto_corrente_responde_esse(self) -> None:
        memory = _wm(current_product_id=P1, candidate_product_ids=[P1, P2])
        assert memory.resolve_referenced_product() == P1

    def test_candidato_unico_responde_esse(self) -> None:
        memory = _wm(candidate_product_ids=[P2])
        assert memory.resolve_referenced_product() == P2

    def test_ambiguidade_nao_chuta(self) -> None:
        """Dois candidatos e nenhum corrente: o agente tem que perguntar, não
        escolher. Devolver o primeiro seria o tipo de palpite que vira
        orçamento do produto errado."""
        memory = _wm(candidate_product_ids=[P1, P2])
        assert memory.resolve_referenced_product() is None

    def test_ordinal_resolve_o_segundo(self) -> None:
        memory = _wm(candidate_product_ids=[P1, P2, P3])
        assert memory.resolve_referenced_product(ordinal=2) == P2

    def test_ordinal_fora_do_intervalo(self) -> None:
        memory = _wm(candidate_product_ids=[P1])
        assert memory.resolve_referenced_product(ordinal=5) is None

    def test_cai_para_ultimo_valido(self) -> None:
        """Busca sem resultado não pode apagar o que o cliente já estava vendo."""
        memory = _wm(candidate_product_ids=[], last_valid_product_ids=[P3])
        assert memory.resolve_referenced_product() == P3

    def test_sem_nada_devolve_none(self) -> None:
        assert _wm().resolve_referenced_product() is None


class TestMemoriaEpisodica:
    def test_confianca_limitada_pela_origem(self) -> None:
        """Inferência do modelo não pode valer tanto quanto confirmação humana."""
        memory = episodic.build(
            company_id=COMPANY_A,
            lead_id=uuid4(),
            conversation_id=None,
            memory_type="preference",
            content="prefere parcelamento",
            source="agent_inferred",
            confidence=1.0,
        )
        assert memory.confidence == episodic.SOURCE_CONFIDENCE_CAP["agent_inferred"]

    def test_humano_confirmado_mantem_confianca(self) -> None:
        memory = episodic.build(
            company_id=COMPANY_A,
            lead_id=uuid4(),
            conversation_id=None,
            memory_type="fact",
            content="espaço de 6x3",
            source="human_confirmed",
            confidence=1.0,
        )
        assert memory.confidence == 1.0

    def test_memoria_temporal_expira(self) -> None:
        memory = episodic.build(
            company_id=COMPANY_A,
            lead_id=uuid4(),
            conversation_id=None,
            memory_type="timing",
            content="pretende comprar em outubro",
            source="agent_inferred",
            confidence=0.6,
        )
        assert memory.expires_at is not None

    def test_preferencia_nao_expira(self) -> None:
        memory = episodic.build(
            company_id=COMPANY_A,
            lead_id=uuid4(),
            conversation_id=None,
            memory_type="preference",
            content="prefere contato por áudio",
            source="human_confirmed",
            confidence=0.9,
        )
        assert memory.expires_at is None

    def test_validade_no_tempo(self) -> None:
        agora = datetime.now(UTC)
        memory = EpisodicMemory(
            company_id=COMPANY_A,
            lead_id=uuid4(),
            memory_type="timing",
            content="x",
            confidence=0.5,
            source="agent_inferred",
            expires_at=agora - timedelta(days=1),
        )
        assert not memory.is_valid_at(agora)

    def test_contexto_expoe_confianca(self) -> None:
        """O modelo precisa saber o que é inferência para poder confrontar."""
        memory = episodic.build(
            company_id=COMPANY_A,
            lead_id=uuid4(),
            conversation_id=None,
            memory_type="objection",
            content="achou caro",
            source="agent_inferred",
            confidence=0.6,
        )
        texto = episodic.to_context([memory])
        assert "0.60" in texto
        assert "achou caro" in texto

    def test_contexto_vazio(self) -> None:
        assert episodic.to_context([]) == ""
