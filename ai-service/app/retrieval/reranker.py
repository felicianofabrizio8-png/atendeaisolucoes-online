"""Reranking.

Desacoplado por protocolo para trocar por um cross-encoder ou API dedicada
depois, sem tocar na busca. A versão inicial é score combinado — sem custo
externo, e suficiente para validar a arquitetura.

Prioridade de fonte é a parte com regra de negócio de verdade: conhecimento
oficial pesa mais que aprendizado do Coach. Isso implementa a regra do
briefing de que aprendizado **nunca substitui fato oficial** — se as duas
fontes competirem pelo mesmo trecho de contexto, a oficial ganha.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol

from app.schemas.retrieval import ScoredChunk

SOURCE_PRIORITY: dict[str, float] = {
    "commercial_policy": 1.0,
    "product": 0.95,
    "faq": 0.85,
    "document": 0.7,
    "playbook": 0.6,
    "coach_learning": 0.45,
}

WEIGHTS = {
    "semantic": 0.55,
    "keyword": 0.30,
    "recency": 0.05,
    "source": 0.10,
}

# Meia-vida da recência. 180 dias: política comercial de um ano atrás ainda
# vale alguma coisa, mas menos que a revisada mês passado.
RECENCY_HALFLIFE_DAYS = 180.0


class Reranker(Protocol):
    def rerank(self, chunks: list[ScoredChunk], top_k: int) -> list[ScoredChunk]: ...


def recency_score(created_at: datetime | None, *, now: datetime | None = None) -> float:
    if created_at is None:
        return 0.0
    now = now or datetime.now(UTC)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    days = max((now - created_at).total_seconds() / 86400.0, 0.0)
    return 0.5 ** (days / RECENCY_HALFLIFE_DAYS)


class WeightedReranker:
    """Combinação linear das quatro notas."""

    def rerank(self, chunks: list[ScoredChunk], top_k: int) -> list[ScoredChunk]:
        now = datetime.now(UTC)
        out: list[ScoredChunk] = []
        for scored in chunks:
            created = scored.chunk.metadata.get("created_at")
            recency = (
                scored.recency_score
                if scored.recency_score
                else recency_score(created if isinstance(created, datetime) else None, now=now)
            )
            priority = SOURCE_PRIORITY.get(scored.chunk.source_type, 0.5)
            final = (
                WEIGHTS["semantic"] * scored.semantic_score
                + WEIGHTS["keyword"] * scored.keyword_score
                + WEIGHTS["recency"] * recency
                + WEIGHTS["source"] * priority
            )
            out.append(
                scored.model_copy(
                    update={
                        "recency_score": recency,
                        "source_priority": priority,
                        "final_score": final,
                    }
                )
            )
        out.sort(key=lambda s: s.final_score, reverse=True)
        return out[:top_k]


def get_reranker() -> Reranker:
    return WeightedReranker()


__all__ = [
    "RECENCY_HALFLIFE_DAYS",
    "SOURCE_PRIORITY",
    "WEIGHTS",
    "Reranker",
    "WeightedReranker",
    "get_reranker",
    "recency_score",
]
