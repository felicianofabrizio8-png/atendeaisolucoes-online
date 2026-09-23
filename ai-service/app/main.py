"""Entrypoint do FastAPI."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import router
from app.config import settings
from app.database import connection

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Abre o pool na subida e fecha na descida.

    Falha de banco na subida **derruba o serviço** de propósito: um
    `ai-service` sem banco não consegue aterrar nenhum fato, e subir mesmo
    assim só produziria respostas sem fundamento com aparência de saúde.
    """
    settings.require_service_auth()
    await connection.init_pool()
    logger.info(
        "ai-service pronto",
        extra={
            "env": settings.app_env,
            "mode": settings.default_execution_mode,
            "external_actions": settings.allow_external_actions,
        },
    )
    if settings.allow_external_actions and not settings.is_production:
        logger.warning("ALLOW_EXTERNAL_ACTIONS=true fora de produção")
    try:
        yield
    finally:
        await connection.close_pool()


app = FastAPI(
    title="Atende Aí — AI Service",
    version="0.1.0",
    description="AI Control Plane: agente de vendas, memória, RAG e policy engine.",
    lifespan=lifespan,
    # Docs fechadas em produção: o schema descreve toda a superfície interna.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
    openapi_url=None if settings.is_production else "/openapi.json",
)

app.include_router(router)

__all__ = ["app"]
