"""Worker da fila `agent_jobs`.

Reusa a fila que já existe (migration `20260713151715`) em vez de criar outra,
como o briefing pediu. Ela já traz o que um worker precisa: claim atômico via
`dequeue_agent_job` (`FOR UPDATE SKIP LOCKED`), `attempts`/`max_attempts`,
`dead_letter`, `locked_by` e índice único parcial de dedupe.

Sem Redis e sem Celery. O Postgres já é a fila, e adicionar um broker aqui
seria mais um serviço para operar sem problema que o justifique.

**Idempotência.** O `dedupe_key` impede job duplicado *entrando*. Para o caso
de o mesmo job ser processado duas vezes (timeout do lock, worker morto depois
do efeito e antes do commit), a defesa é a chave idempotente que cada ação
externa carrega — ver `tools/deps.AgentDeps.action_key`.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any
from uuid import UUID

from app.config import settings
from app.database.connection import admin_transaction
from app.database.repositories.jobs import JobRepository
from app.schemas.agent import SalesTurnRequest
from app.workflows import sales_turn

logger = logging.getLogger(__name__)

JOB_TYPE_SALES_TURN = "python_sales_turn"


async def handle_job(job: dict[str, Any]) -> None:
    """Executa um job já reivindicado."""
    job_type = job["job_type"]
    payload: dict[str, Any] = job.get("payload_json") or {}

    if job_type != JOB_TYPE_SALES_TURN:
        raise ValueError(f"job_type não suportado: {job_type}")

    conversation_id = payload.get("conversation_id")
    if not conversation_id:
        raise ValueError("payload sem conversation_id")

    # company_id vem do JOB, nunca do payload do cliente: é a coluna que a
    # própria fila garante, com FK para companies.
    request = SalesTurnRequest(
        company_id=UUID(str(job["company_id"])),
        conversation_id=UUID(str(conversation_id)),
        lead_id=UUID(str(payload["lead_id"])) if payload.get("lead_id") else None,
        idempotency_key=job.get("dedupe_key") or str(job["id"]),
        correlation_id=payload.get("correlation_id"),
    )

    result = await sales_turn.run_turn(request)
    logger.info(
        "job processado",
        extra={
            "job_id": str(job["id"]),
            "action": result.decision.action,
            "mode": result.execution_mode,
            "executed": result.executed,
            "blocked": result.blocked_reason,
            "latency_ms": result.latency_ms,
        },
    )


async def process_one() -> bool:
    """Reivindica e processa um job. Devolve False quando a fila está vazia.

    O claim e o resultado ficam em transações separadas de propósito: se
    ficassem na mesma, uma falha no processamento faria rollback do claim e o
    job voltaria para `pending` sem incrementar `attempts` — um job
    problemático giraria para sempre.
    """
    async with admin_transaction() as conn:
        job = await JobRepository(conn).claim(
            worker_id=settings.worker_id,
            job_types=settings.job_types,
            lock_seconds=settings.worker_lock_seconds,
        )

    if job is None:
        return False

    try:
        await handle_job(job)
    except Exception as err:
        logger.exception("job falhou", extra={"job_id": str(job["id"])})
        async with admin_transaction() as conn:
            await JobRepository(conn).fail(job["id"], str(err))
        return True

    async with admin_transaction() as conn:
        await JobRepository(conn).complete(job["id"])
    return True


async def process_batch(*, max_jobs: int = 1) -> int:
    processed = 0
    for _ in range(max_jobs):
        if not await process_one():
            break
        processed += 1
    return processed


async def run_forever() -> None:
    """Laço do worker. Usar quando houver processo dedicado; do contrário, um
    cron externo pode chamar POST /v1/jobs/process."""
    from app.database.connection import close_pool, init_pool

    await init_pool()
    logger.info(
        "worker iniciado",
        extra={"worker_id": settings.worker_id, "job_types": settings.job_types},
    )
    try:
        while True:
            try:
                did_work = await process_one()
            except Exception:
                # Erro de infraestrutura (banco fora, por exemplo). Dormir e
                # seguir: derrubar o worker só transfere o problema.
                logger.exception("erro no laço do worker")
                did_work = False
            if not did_work:
                await asyncio.sleep(settings.worker_poll_interval_seconds)
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(run_forever())


__all__ = ["JOB_TYPE_SALES_TURN", "handle_job", "process_batch", "process_one", "run_forever"]
