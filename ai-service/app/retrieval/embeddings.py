"""Camada de embedding desacoplada.

O protocolo existe para que nenhuma outra parte do código saiba qual provider
está em uso. Trocar de modelo deve ser trocar a implementação aqui — e uma
migration, porque a dimensão está no DDL.
"""

from __future__ import annotations

from typing import Protocol

from app.config import settings
from app.llm import gateway


class EmbeddingProvider(Protocol):
    @property
    def dimension(self) -> int: ...

    async def embed_query(self, text: str) -> list[float]: ...

    async def embed_documents(self, texts: list[str]) -> list[list[float]]: ...


class LiteLLMEmbeddings:
    """Implementação padrão. `embed_query` e `embed_documents` são métodos
    distintos porque alguns modelos pedem prefixo diferente para consulta e
    documento — hoje não usamos, mas a assinatura já comporta."""

    @property
    def dimension(self) -> int:
        return settings.embedding_dim

    async def embed_query(self, text: str) -> list[float]:
        vectors = await gateway.embed([text])
        return vectors[0]

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Processa em lotes para não estourar limite de payload do provider."""
        out: list[list[float]] = []
        size = settings.embedding_batch_size
        for start in range(0, len(texts), size):
            out.extend(await gateway.embed(texts[start : start + size]))
        return out


def get_embedding_provider() -> EmbeddingProvider:
    return LiteLLMEmbeddings()


__all__ = ["EmbeddingProvider", "LiteLLMEmbeddings", "get_embedding_provider"]
