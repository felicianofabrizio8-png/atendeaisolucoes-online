"""Contratos do retrieval híbrido.

`company_id` não é filtro opcional: ele mora no `TenantScope` que toda busca
exige, e não é expressável em `RetrievalFilters`. Assim não existe caminho de
código em que alguém "esqueça" de filtrar por empresa.
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

SourceType = Literal[
    "product",
    "faq",
    "commercial_policy",
    "coach_learning",
    "playbook",
    "document",
]


class RetrievalFilters(BaseModel):
    """Filtros de metadado. Note a ausência de company_id — proposital."""

    source_types: list[SourceType] | None = None
    product_id: UUID | None = None
    category: str | None = None
    document_type: str | None = None
    active_only: bool = True


class RetrievalQuery(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    filters: RetrievalFilters = Field(default_factory=RetrievalFilters)
    top_k: int = Field(default=8, ge=1, le=50)
    # Quantos candidatos cada perna traz antes do merge. Maior = melhor
    # recall, mais custo de rerank.
    candidates: int = Field(default=40, ge=1, le=200)


class Chunk(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    document_id: UUID | None
    company_id: UUID
    source_type: str
    source_id: UUID | None
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class ScoredChunk(BaseModel):
    """Chunk com as notas separadas.

    Guardar as parcelas em vez de só o total é o que permite depurar por que
    um documento subiu, e trocar o reranker depois sem refazer a busca.
    """

    chunk: Chunk
    semantic_score: float = 0.0
    keyword_score: float = 0.0
    recency_score: float = 0.0
    source_priority: float = 0.0
    final_score: float = 0.0

    def with_final(self, value: float) -> ScoredChunk:
        return self.model_copy(update={"final_score": value})


class RetrievalResult(BaseModel):
    chunks: list[ScoredChunk] = Field(default_factory=list)
    semantic_count: int = 0
    keyword_count: int = 0
    took_ms: int = 0

    def to_context(self, max_chars: int = 4000) -> str:
        """Concatena para o prompt respeitando um teto de caracteres.

        Corta no limite de chunk, nunca no meio: meio parágrafo de política
        comercial é pior que parágrafo nenhum.
        """
        parts: list[str] = []
        remaining = max_chars
        for scored in self.chunks:
            piece = scored.chunk.content.strip()
            if len(piece) > remaining:
                break
            parts.append(piece)
            remaining -= len(piece) + 2
        return "\n\n".join(parts)


class IndexRequest(BaseModel):
    company_id: UUID
    source_type: SourceType
    source_id: UUID | None = None
    title: str | None = None
    content: str = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)
    # Reindexar a mesma fonte substitui os chunks antigos em vez de duplicar.
    replace_existing: bool = True


class IndexResult(BaseModel):
    document_id: UUID
    chunks_written: int
    chunks_removed: int = 0


__all__ = [
    "Chunk",
    "IndexRequest",
    "IndexResult",
    "RetrievalFilters",
    "RetrievalQuery",
    "RetrievalResult",
    "ScoredChunk",
    "SourceType",
]
