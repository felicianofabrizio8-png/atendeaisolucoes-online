"""Endpoints internos.

```text
GET  /health                  público
POST /v1/agents/sales/turn    autenticado
POST /v1/retrieval/search     autenticado
POST /v1/memory/index         autenticado
POST /v1/jobs/process         autenticado
```

`company_id` vem no corpo em `/v1/agents/sales/turn`, mas **não é confiado**:
o handler confere que a conversa pertence àquela empresa antes de qualquer
coisa. Mesmo princípio do `agent-trigger` em TS, que deriva o `company_id` da
conversa em vez de aceitar o do cliente.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.deps import ServiceAuth
from app.config import settings
from app.database import connection
from app.database.repositories.chunks import ChunkRepository
from app.database.repositories.knowledge import KnowledgeRepository
from app.database.repositories.products import ProductRepository
from app.policies.tenant import TenantScope, TenantViolationError
from app.retrieval import hybrid_search, indexer
from app.retrieval.embeddings import get_embedding_provider
from app.retrieval.reranker import get_reranker
from app.schemas.agent import SalesTurnRequest, SalesTurnResult
from app.schemas.retrieval import IndexRequest, IndexResult, RetrievalQuery, RetrievalResult
from app.workflows import sales_turn

logger = logging.getLogger(__name__)

router = APIRouter()


class HealthResponse(BaseModel):
    status: str
    app_env: str
    database: bool
    external_actions_allowed: bool


@router.get("/health", response_model=HealthResponse, tags=["infra"])
async def health() -> HealthResponse:
    """Healthcheck. Público de propósito — é o que o orquestrador consulta.

    Não expõe versão de dependência nem configuração: só o suficiente para
    saber se o serviço está de pé.
    """
    db_ok = await connection.healthcheck()
    return HealthResponse(
        status="ok" if db_ok else "degraded",
        app_env=settings.app_env,
        database=db_ok,
        external_actions_allowed=settings.allow_external_actions,
    )


@router.post(
    "/v1/agents/sales/turn",
    response_model=SalesTurnResult,
    tags=["agents"],
)
async def sales_turn_endpoint(request: SalesTurnRequest, _: ServiceAuth) -> SalesTurnResult:
    try:
        return await sales_turn.run_turn(request)
    except TenantViolationError:
        # Violação de tenant é erro de programação, não condição esperada.
        # Loga com stack e devolve 500 genérico — nunca detalhe do escopo.
        logger.exception("violação de tenant no turno")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="internal error"
        ) from None


class RetrievalRequest(BaseModel):
    company_id: UUID
    query: RetrievalQuery


@router.post("/v1/retrieval/search", response_model=RetrievalResult, tags=["retrieval"])
async def retrieval_search(request: RetrievalRequest, _: ServiceAuth) -> RetrievalResult:
    scope = TenantScope(company_id=request.company_id)
    async with connection.tenant_transaction(scope) as conn:
        repo = ChunkRepository(conn, scope)
        return await hybrid_search.search(
            repo,
            request.query,
            embeddings=get_embedding_provider(),
            reranker=get_reranker(),
        )


class IndexCompanyRequest(BaseModel):
    company_id: UUID
    # Sem `document`: indexa as fontes internas (FAQ aprovada, políticas,
    # coach learnings ativos). Com `document`: indexa aquele conteúdo.
    document: IndexRequest | None = None


@router.post("/v1/memory/index", tags=["memory"])
async def memory_index(request: IndexCompanyRequest, _: ServiceAuth) -> dict[str, Any]:
    scope = TenantScope(company_id=request.company_id)
    embeddings = get_embedding_provider()

    async with connection.tenant_transaction(scope) as conn:
        chunks_repo = ChunkRepository(conn, scope)

        if request.document is not None:
            scope.guard(request.document.company_id, "memory_index.document")
            result: IndexResult = await indexer.index_document(
                request.document, chunks_repo=chunks_repo, embeddings=embeddings
            )
            return {"documents": 1, "chunks": result.chunks_written}

        results = await indexer.index_company_sources(
            request.company_id,
            chunks_repo=chunks_repo,
            knowledge_repo=KnowledgeRepository(conn, scope),
            products_repo=ProductRepository(conn, scope),
            embeddings=embeddings,
        )
        return {
            "documents": len(results),
            "chunks": sum(r.chunks_written for r in results),
        }


class ProcessJobsRequest(BaseModel):
    max_jobs: int = 1


@router.post("/v1/jobs/process", tags=["jobs"])
async def process_jobs(request: ProcessJobsRequest, _: ServiceAuth) -> dict[str, int]:
    """Tick manual do worker. Útil em desenvolvimento e para o cron externo
    chamar sem manter processo dedicado de pé."""
    from app.workers.agent_jobs import process_batch

    processed = await process_batch(max_jobs=request.max_jobs)
    return {"processed": processed}


__all__ = ["router"]
