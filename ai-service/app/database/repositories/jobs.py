"""Fila `agent_jobs`.

**Único repositório cross-tenant do serviço, de propósito.** O dequeue precisa
olhar todas as empresas para pegar o próximo job; o `company_id` vem *dentro*
do job e é o que cria o `TenantScope` do turno. Por isso ele usa
`admin_transaction()` e não herda `TenantRepository`.

Nada de dado comercial é lido aqui. Se um dia precisar, está no lugar errado.

A fila já existe e é boa (migration `20260713151715`): `dequeue_agent_job` faz
`FOR UPDATE SKIP LOCKED`, há índice único parcial em `(company_id, dedupe_key)`
para status ativos, e `attempts`/`max_attempts`/`dead_letter` estão prontos.
O briefing pedia para não criar outra fila — e não há mesmo motivo.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import DictRow


class JobRepository:
    def __init__(self, conn: AsyncConnection[DictRow]) -> None:
        self._conn = conn

    async def claim(
        self, *, worker_id: str, job_types: list[str], lock_seconds: int
    ) -> dict[str, Any] | None:
        """Reivindica um job. Atômico via RPC existente."""
        async with self._conn.cursor() as cur:
            await cur.execute(
                "SELECT * FROM public.dequeue_agent_job(%s, %s, %s)",
                (worker_id, job_types, lock_seconds),
            )
            row = await cur.fetchone()
            return dict(row) if row else None

    async def complete(self, job_id: UUID) -> None:
        async with self._conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE public.agent_jobs
                   SET status = 'completed', finished_at = now(),
                       locked_at = NULL, locked_by = NULL
                 WHERE id = %s
                """,
                (job_id,),
            )

    async def fail(self, job_id: UUID, error: str, *, retry_in_seconds: int = 60) -> None:
        """Marca falha.

        Vai para `dead_letter` quando estourar `max_attempts`; caso contrário
        volta para `pending` com backoff. `attempts` já foi incrementado pelo
        dequeue, então a comparação usa o valor corrente.
        """
        async with self._conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE public.agent_jobs
                   SET status = CASE
                                  WHEN attempts >= max_attempts THEN 'dead_letter'
                                  ELSE 'pending'
                                END,
                       available_at = now() + make_interval(secs => %s),
                       last_error = LEFT(%s, 2000),
                       locked_at = NULL,
                       locked_by = NULL,
                       finished_at = CASE
                                       WHEN attempts >= max_attempts THEN now()
                                       ELSE NULL
                                     END
                 WHERE id = %s
                """,
                (retry_in_seconds, error, job_id),
            )

    async def enqueue(
        self,
        *,
        company_id: UUID,
        job_type: str,
        payload: dict[str, Any],
        dedupe_key: str | None = None,
        priority: int = 100,
    ) -> UUID | None:
        """Enfileira. Devolve None quando o dedupe barrou (job equivalente já
        pendente ou em processamento) — que é sucesso, não erro."""
        import json

        async with self._conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO public.agent_jobs
                    (company_id, job_type, payload_json, dedupe_key, priority)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
                RETURNING id
                """,
                (company_id, job_type, json.dumps(payload), dedupe_key, priority),
            )
            row = await cur.fetchone()
            return row["id"] if row else None


__all__ = ["JobRepository"]
