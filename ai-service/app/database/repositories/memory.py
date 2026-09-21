"""Memória episódica e resumo incremental.

Tabelas novas (`migrations/0002_ai_memory.sql`): `ai_episodic_memories` e
`ai_conversation_summaries`. Não havia equivalente no sistema atual — o agente
TS reenvia as últimas 20 mensagens a cada turno
(`sales-agent-core.ts:1082`), que é exatamente o que queremos parar de fazer.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from app.database.repositories.base import TenantRepository
from app.schemas.memory import ConversationSummary, EpisodicMemory


class MemoryRepository(TenantRepository):
    async def list_episodic(
        self, lead_id: UUID, *, now: datetime, limit: int = 20
    ) -> list[EpisodicMemory]:
        """Memórias válidas do lead, mais confiáveis primeiro.

        Expiradas são filtradas no SQL: "cliente pretende comprar em outubro"
        não pode continuar guiando a conversa em dezembro.
        """
        sql = """
            SELECT id, company_id, lead_id, conversation_id, memory_type,
                   content, confidence, source, created_at, expires_at
              FROM public.ai_episodic_memories
             WHERE company_id = %s
               AND lead_id = %s
               AND (expires_at IS NULL OR expires_at > %s)
             ORDER BY confidence DESC, created_at DESC
             LIMIT %s
        """
        rows = await self._fetch_all(sql, (self.company_id, lead_id, now, limit))
        self._guard_rows(rows, "memory.list_episodic")
        return [EpisodicMemory.model_validate(r) for r in rows]

    async def add_episodic(self, memory: EpisodicMemory) -> UUID:
        self._scope.guard(memory.company_id, "memory.add_episodic")
        sql = """
            INSERT INTO public.ai_episodic_memories
                (company_id, lead_id, conversation_id, memory_type,
                 content, confidence, source, expires_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """
        row = await self._fetch_one(
            sql,
            (
                self.company_id,
                memory.lead_id,
                memory.conversation_id,
                memory.memory_type,
                memory.content,
                memory.confidence,
                memory.source,
                memory.expires_at,
            ),
        )
        assert row is not None
        return row["id"]

    async def get_summary(self, conversation_id: UUID) -> ConversationSummary | None:
        sql = """
            SELECT company_id, conversation_id, summary, covered_until, message_count
              FROM public.ai_conversation_summaries
             WHERE company_id = %s AND conversation_id = %s
             LIMIT 1
        """
        row = await self._fetch_one(sql, (self.company_id, conversation_id))
        row = self._guard_row(row, "memory.get_summary")
        return ConversationSummary.model_validate(row) if row else None

    async def upsert_summary(self, summary: ConversationSummary) -> None:
        self._scope.guard(summary.company_id, "memory.upsert_summary")
        sql = """
            INSERT INTO public.ai_conversation_summaries
                (company_id, conversation_id, summary, covered_until, message_count)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (company_id, conversation_id)
            DO UPDATE SET summary       = EXCLUDED.summary,
                          covered_until = EXCLUDED.covered_until,
                          message_count = EXCLUDED.message_count,
                          updated_at    = now()
        """
        await self._execute(
            sql,
            (
                self.company_id,
                summary.conversation_id,
                summary.summary,
                summary.covered_until,
                summary.message_count,
            ),
        )


__all__ = ["MemoryRepository"]
