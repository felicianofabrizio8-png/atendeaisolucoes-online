"""Conhecimento da empresa e políticas comerciais.

`get_commercial_policy` é a fonte para forma de pagamento, prazo, instalação,
frete e itens inclusos. Campo não cadastrado volta como `None` — e o agente
deve dizer que não sabe. Inventar condição comercial é o erro mais caro que
este sistema pode cometer, porque vira promessa ao cliente.
"""

from __future__ import annotations

import time

from app.memory import semantic
from app.schemas.retrieval import RetrievalFilters, SourceType
from app.schemas.tools import (
    CommercialPolicy,
    KnowledgeHit,
    KnowledgeSearchResult,
    ToolError,
)
from app.tools.deps import AgentDeps


async def search_company_knowledge(
    deps: AgentDeps,
    query: str,
    *,
    source_types: list[str] | None = None,
    limit: int = 5,
) -> KnowledgeSearchResult | ToolError:
    """Busca híbrida no conhecimento indexado da empresa."""
    started = time.perf_counter()
    try:
        typed: list[SourceType] | None = (
            [t for t in source_types if t in _VALID_SOURCES]  # type: ignore[misc]
            if source_types
            else None
        )
        result = await semantic.search(
            deps.chunks,
            query,
            embeddings=deps.embeddings,
            reranker=deps.reranker,
            filters=RetrievalFilters(source_types=typed),
            top_k=limit,
        )
        hits = [
            KnowledgeHit(
                chunk_id=s.chunk.id,
                document_id=s.chunk.document_id,
                content=s.chunk.content,
                source_type=s.chunk.source_type,
                score=s.final_score,
                metadata={k: v for k, v in s.chunk.metadata.items() if k != "created_at"},
            )
            for s in result.chunks
        ]
        deps.record("search_company_knowledge", ok=True, duration_ms=_ms(started))
        return KnowledgeSearchResult(hits=hits)
    except Exception as err:
        deps.record(
            "search_company_knowledge",
            ok=False,
            duration_ms=_ms(started),
            error_code="internal",
        )
        return ToolError(code="internal", message=f"falha na busca: {err}")


async def get_commercial_policy(deps: AgentDeps) -> CommercialPolicy | ToolError:
    """Políticas oficiais. Única fonte válida para condição comercial."""
    started = time.perf_counter()
    try:
        policy = await deps.knowledge.get_commercial_policy()
        deps.record("get_commercial_policy", ok=True, duration_ms=_ms(started))
        return policy
    except Exception as err:
        deps.record(
            "get_commercial_policy",
            ok=False,
            duration_ms=_ms(started),
            error_code="internal",
        )
        return ToolError(code="internal", message=str(err))


_VALID_SOURCES = {
    "product",
    "faq",
    "commercial_policy",
    "coach_learning",
    "playbook",
    "document",
}


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


__all__ = ["get_commercial_policy", "search_company_knowledge"]
