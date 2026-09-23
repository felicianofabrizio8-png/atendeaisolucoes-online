"""Busca híbrida: normalização, reranking e chunking."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.retrieval.hybrid_search import _normalize
from app.retrieval.indexer import chunk_text, normalize
from app.retrieval.reranker import SOURCE_PRIORITY, WeightedReranker, recency_score
from app.schemas.retrieval import Chunk, ScoredChunk
from tests.conftest import COMPANY_A


class TestNormalizacao:
    def test_escala_para_zero_um(self) -> None:
        assert _normalize([1.0, 2.0, 3.0]) == [0.0, 0.5, 1.0]

    def test_valores_iguais_viram_um(self) -> None:
        """Sem isso, uma lista homogênea viraria divisão por zero."""
        assert _normalize([5.0, 5.0]) == [1.0, 1.0]

    def test_lista_vazia(self) -> None:
        assert _normalize([]) == []

    def test_negativos(self) -> None:
        """Cosseno vai de -1 a 1; a normalização precisa aguentar."""
        assert _normalize([-1.0, 0.0, 1.0]) == [0.0, 0.5, 1.0]


def _scored(source_type: str, semantic: float = 0.0, keyword: float = 0.0) -> ScoredChunk:
    return ScoredChunk(
        chunk=Chunk(
            id=uuid4(),
            document_id=uuid4(),
            company_id=COMPANY_A,
            source_type=source_type,
            source_id=None,
            content=f"conteúdo de {source_type}",
            metadata={"created_at": datetime.now(UTC)},
        ),
        semantic_score=semantic,
        keyword_score=keyword,
    )


class TestReranker:
    def test_politica_oficial_vence_aprendizado(self) -> None:
        """Regra do briefing: aprendizado nunca substitui fato oficial. Com as
        mesmas notas de busca, a política tem que subir."""
        ranked = WeightedReranker().rerank(
            [
                _scored("coach_learning", semantic=0.8),
                _scored("commercial_policy", semantic=0.8),
            ],
            top_k=2,
        )
        assert ranked[0].chunk.source_type == "commercial_policy"

    def test_prioridade_de_fonte_documentada(self) -> None:
        assert SOURCE_PRIORITY["commercial_policy"] > SOURCE_PRIORITY["coach_learning"]

    def test_top_k_corta(self) -> None:
        ranked = WeightedReranker().rerank([_scored("faq") for _ in range(10)], top_k=3)
        assert len(ranked) == 3

    def test_notas_parciais_preservadas(self) -> None:
        """Guardar as parcelas é o que permite explicar por que um documento
        apareceu — e trocar os pesos sem refazer a busca."""
        ranked = WeightedReranker().rerank([_scored("faq", semantic=0.9, keyword=0.4)], top_k=1)
        assert ranked[0].semantic_score == 0.9
        assert ranked[0].keyword_score == 0.4
        assert ranked[0].source_priority > 0
        assert ranked[0].final_score > 0

    def test_recencia_decai(self) -> None:
        agora = datetime.now(UTC)
        novo = recency_score(agora, now=agora)
        antigo = recency_score(agora - timedelta(days=365), now=agora)
        assert novo > antigo

    def test_recencia_sem_data(self) -> None:
        assert recency_score(None) == 0.0


class TestChunking:
    def test_texto_curto_vira_um_chunk(self) -> None:
        assert chunk_text("Piscina 6x3 em fibra.") == ["Piscina 6x3 em fibra."]

    def test_texto_vazio(self) -> None:
        assert chunk_text("") == []

    def test_divide_texto_longo(self) -> None:
        texto = "\n\n".join("parágrafo " * 30 for _ in range(10))
        pedacos = chunk_text(texto, target=500, overlap=50)
        assert len(pedacos) > 1
        assert all(len(p) <= 700 for p in pedacos)

    def test_normalize_colapsa_espaco(self) -> None:
        assert normalize("a   b\r\n\r\n\r\n\r\nc") == "a b\n\nc"

    def test_paragrafo_gigante_e_cortado(self) -> None:
        """Parágrafo maior que o alvo não pode virar um chunk único gigante —
        estoura o limite do embedding."""
        pedacos = chunk_text("x" * 5000, target=900, overlap=0)
        assert len(pedacos) > 1
