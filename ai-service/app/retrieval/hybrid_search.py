"""Busca híbrida: vetorial + léxica, fundidas e reordenadas.

```text
query
 |
 +----------------+
 |                |
 v                v
semântica       keyword
pgvector        FTS português
 |                |
 +--------+-------+
          |
          v
        merge          (por chunk_id, preservando as duas notas)
          |
          v
       reranking
          |
          v
        top K
```

O merge guarda as duas notas separadas em vez de somar na hora. É o que
permite responder "por que este documento apareceu?" — e trocar os pesos do
reranker sem refazer a busca.
"""

from __future__ import annotations

import time
from typing import Any
from uuid import UUID

from app.database.repositories.chunks import ChunkRepository
from app.retrieval.embeddings import EmbeddingProvider
from app.retrieval.reranker import Reranker
from app.schemas.retrieval import Chunk, RetrievalQuery, RetrievalResult, ScoredChunk


def _to_chunk(row: dict[str, Any]) -> Chunk:
    return Chunk(
        id=row["id"],
        document_id=row.get("document_id"),
        company_id=row["company_id"],
        source_type=row["source_type"],
        source_id=row.get("source_id"),
        content=row["content"],
        metadata={**(row.get("metadata") or {}), "created_at": row.get("created_at")},
    )


def _normalize(values: list[float]) -> list[float]:
    """Min-max para [0,1].

    Necessário porque as duas pernas vivem em escalas diferentes: similaridade
    cosseno é [-1,1] e `ts_rank` é ilimitado para cima. Somar as duas cruas
    deixaria o peso real à mercê da escala, não da configuração.
    """
    if not values:
        return []
    low, high = min(values), max(values)
    if high - low < 1e-9:
        return [1.0 for _ in values]
    return [(v - low) / (high - low) for v in values]


async def search(
    repo: ChunkRepository,
    query: RetrievalQuery,
    *,
    embeddings: EmbeddingProvider,
    reranker: Reranker,
) -> RetrievalResult:
    started = time.perf_counter()

    source_types: list[str] | None = (
        [str(s) for s in query.filters.source_types] if query.filters.source_types else None
    )
    product_id: UUID | None = query.filters.product_id

    vector = await embeddings.embed_query(query.text)

    semantic_rows = await repo.semantic_search(
        vector, limit=query.candidates, source_types=source_types, product_id=product_id
    )
    keyword_rows = await repo.keyword_search(
        query.text, limit=query.candidates, source_types=source_types, product_id=product_id
    )

    semantic_norm = _normalize([float(r.get("semantic_score") or 0.0) for r in semantic_rows])
    keyword_norm = _normalize([float(r.get("keyword_score") or 0.0) for r in keyword_rows])

    merged: dict[UUID, ScoredChunk] = {}

    for row, score in zip(semantic_rows, semantic_norm, strict=True):
        merged[row["id"]] = ScoredChunk(chunk=_to_chunk(row), semantic_score=score)

    for row, score in zip(keyword_rows, keyword_norm, strict=True):
        existing = merged.get(row["id"])
        if existing is not None:
            merged[row["id"]] = existing.model_copy(update={"keyword_score": score})
        else:
            merged[row["id"]] = ScoredChunk(chunk=_to_chunk(row), keyword_score=score)

    ranked = reranker.rerank(list(merged.values()), query.top_k)

    return RetrievalResult(
        chunks=ranked,
        semantic_count=len(semantic_rows),
        keyword_count=len(keyword_rows),
        took_ms=int((time.perf_counter() - started) * 1000),
    )


__all__ = ["search"]
