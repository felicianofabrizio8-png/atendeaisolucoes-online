"""Pool de conexões e transação com escopo de empresa.

Toda leitura/escrita comercial passa por `tenant_transaction()`, que abre uma
transação e executa `SET LOCAL app.company_id`. Isso dá duas coisas:

- a RLS consegue enxergar o tenant quando o serviço roda com role dedicada
  (ver `migrations/0003_ai_service_role.sql`);
- o `SET LOCAL` morre com a transação, então uma conexão devolvida ao pool
  nunca carrega o escopo da requisição anterior. Esse detalhe é o motivo de
  ser `SET LOCAL` e não `SET`.

`autocommit=True` no pool é proposital: o `transaction()` do psycopg vira o
único dono do BEGIN/COMMIT, e não sobram transações implícitas abertas
segurando conexão.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.config import settings
from app.policies.tenant import TenantScope

logger = logging.getLogger(__name__)

# Parametrizado explicitamente: o pool devolve conexões com `dict_row`, e sem
# o argumento de tipo o pyright deixa a variável genérica não resolvida.
Pool = AsyncConnectionPool[AsyncConnection[Any]]

_pool: Pool | None = None


async def init_pool() -> Pool:
    """Cria o pool. Idempotente — chamar duas vezes devolve o mesmo pool."""
    global _pool
    if _pool is not None:
        return _pool

    pool: Pool = AsyncConnectionPool(
        conninfo=settings.require_database_url(),
        connection_class=AsyncConnection,
        min_size=settings.db_pool_min,
        max_size=settings.db_pool_max,
        kwargs={"autocommit": True, "row_factory": dict_row},
        open=False,
    )
    await pool.open(wait=True, timeout=10.0)
    _pool = pool
    logger.info(
        "pool aberto", extra={"min": settings.db_pool_min, "max": settings.db_pool_max}
    )
    return pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("pool fechado")


def get_pool() -> Pool:
    if _pool is None:
        raise RuntimeError("pool não inicializado — chame init_pool() no lifespan")
    return _pool


@asynccontextmanager
async def tenant_transaction(scope: TenantScope) -> AsyncIterator[AsyncConnection[Any]]:
    """Transação com `app.company_id` amarrado ao escopo.

    Uso:

        async with tenant_transaction(scope) as conn:
            async with conn.cursor() as cur:
                await cur.execute(...)

    Sai com commit no caminho feliz e rollback em exceção — comportamento do
    `conn.transaction()` do psycopg.
    """
    pool = get_pool()
    async with pool.connection() as conn, conn.transaction():
        async with conn.cursor() as cur:
            # set_config em vez de SET LOCAL literal: parametriza o valor e
            # remove qualquer chance de injeção via company_id.
            await cur.execute(
                "SELECT set_config('app.company_id', %s, true)",
                (str(scope.company_id),),
            )
            if settings.db_statement_timeout_ms > 0:
                await cur.execute(
                    "SELECT set_config('statement_timeout', %s, true)",
                    (str(settings.db_statement_timeout_ms),),
                )
        yield conn


@asynccontextmanager
async def admin_transaction() -> AsyncIterator[AsyncConnection[Any]]:
    """Transação SEM escopo de empresa.

    Existe para exatamente dois casos, ambos cross-tenant por natureza:
    o dequeue de `agent_jobs` e o healthcheck. Qualquer outro uso é bug —
    dado comercial não se lê por aqui.
    """
    pool = get_pool()
    async with pool.connection() as conn, conn.transaction():
        yield conn


async def healthcheck() -> bool:
    try:
        async with admin_transaction() as conn, conn.cursor() as cur:
            await cur.execute("SELECT 1 AS ok")
            row = await cur.fetchone()
            return bool(row and row.get("ok") == 1)
    except Exception:
        logger.exception("healthcheck do banco falhou")
        return False


__all__ = [
    "admin_transaction",
    "close_pool",
    "get_pool",
    "healthcheck",
    "init_pool",
    "tenant_transaction",
]
