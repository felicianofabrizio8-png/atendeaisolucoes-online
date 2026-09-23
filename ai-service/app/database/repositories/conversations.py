"""Conversas, mensagens e estado de venda.

É aqui que mora a tradução de vocabulário citada em `schemas/agent.py`: o banco
guarda `lead_temperature = 'quente'` e `ai_status = 'assumido_humano'`; o
domínio interno usa `hot` e um booleano. A conversão acontece só nesta borda.

Working memory sai de duas fontes (auditoria §3.2) e é remontada em
`memory/working.py`. Este repositório entrega as duas metades cruas.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from app.database.repositories.base import TenantRepository
from app.schemas.agent import ConversationMessage, LeadTemperature

_TEMPERATURE_FROM_DB: dict[str, LeadTemperature] = {
    "frio": "cold",
    "morno": "warm",
    "quente": "hot",
}
_TEMPERATURE_TO_DB = {v: k for k, v in _TEMPERATURE_FROM_DB.items()}


class ConversationRepository(TenantRepository):
    async def get(self, conversation_id: UUID) -> dict[str, Any] | None:
        sql = """
            SELECT id, company_id, lead_id, channel,
                   ai_handling, ai_status, auto_reply_count,
                   last_auto_reply_at, human_takeover_at, last_message_at,
                   detected_city, detected_state, detected_pool_size,
                   detected_intent, detected_interest, detected_budget,
                   purchase_timing, customer_stage, lead_temperature,
                   lead_score, lead_ready_to_close, detected_objections
              FROM public.conversations
             WHERE company_id = %s AND id = %s
             LIMIT 1
        """
        row = await self._fetch_one(sql, (self.company_id, conversation_id))
        return self._guard_row(row, "conversations.get")

    async def recent_messages(
        self, conversation_id: UUID, limit: int = 20
    ) -> list[ConversationMessage]:
        """Últimas N mensagens, em ordem cronológica.

        Busca DESC e inverte: `ORDER BY created_at ASC LIMIT n` traria as
        primeiras da conversa, não as últimas.
        """
        sql = """
            SELECT m.id, m.company_id, m.direction, m.content, m.created_at
              FROM public.messages m
             WHERE m.company_id = %s AND m.conversation_id = %s
             ORDER BY m.created_at DESC
             LIMIT %s
        """
        rows = await self._fetch_all(sql, (self.company_id, conversation_id, limit))
        self._guard_rows(rows, "conversations.recent_messages")
        rows.reverse()
        return [
            ConversationMessage(
                role="lead" if r.get("direction") == "inbound" else "agent",
                text=str(r.get("content") or ""),
                created_at=r.get("created_at"),
            )
            for r in rows
            if str(r.get("content") or "").strip()
        ]

    async def get_sales_state(
        self, scope_type: str, scope_id: UUID
    ) -> dict[str, Any] | None:
        sql = """
            SELECT id, company_id, scope_type, scope_id, intent,
                   product_ids, last_valid_product_ids, attributes, updated_at
              FROM public.conversation_sales_states
             WHERE company_id = %s AND scope_type = %s AND scope_id = %s
             LIMIT 1
        """
        row = await self._fetch_one(sql, (self.company_id, scope_type, scope_id))
        return self._guard_row(row, "conversations.get_sales_state")

    async def upsert_sales_state(
        self,
        *,
        scope_type: str,
        scope_id: UUID,
        intent: str | None,
        product_ids: list[UUID],
        last_valid_product_ids: list[UUID],
        attributes: dict[str, Any],
    ) -> None:
        """Grava o estado. O UNIQUE (company_id, scope_type, scope_id) da
        migration `20260825010000` é o que torna o upsert seguro sob
        concorrência — dois workers no mesmo turno não criam duas linhas."""
        sql = """
            INSERT INTO public.conversation_sales_states
                (company_id, scope_type, scope_id, intent,
                 product_ids, last_valid_product_ids, attributes, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (company_id, scope_type, scope_id)
            DO UPDATE SET
                intent                 = EXCLUDED.intent,
                product_ids            = EXCLUDED.product_ids,
                last_valid_product_ids = EXCLUDED.last_valid_product_ids,
                attributes             = EXCLUDED.attributes,
                updated_at             = now()
        """
        import json

        await self._execute(
            sql,
            (
                self.company_id,
                scope_type,
                scope_id,
                intent,
                [str(p) for p in product_ids],
                [str(p) for p in last_valid_product_ids],
                json.dumps(attributes),
            ),
        )

    async def is_human_active(self, conversation_id: UUID) -> bool:
        """Espelha as duas condições de `shouldAutoReply`
        (`ai-agent.server.ts:165-166`)."""
        row = await self.get(conversation_id)
        if row is None:
            return False
        return bool(row.get("human_takeover_at")) or row.get("ai_status") == "assumido_humano"

    async def seconds_since_last_auto_reply(
        self, conversation_id: UUID, now: datetime
    ) -> float | None:
        row = await self.get(conversation_id)
        last = row.get("last_auto_reply_at") if row else None
        if last is None:
            return None
        return (now - last).total_seconds()


def temperature_from_db(value: str | None) -> LeadTemperature | None:
    return _TEMPERATURE_FROM_DB.get(value) if value else None


def temperature_to_db(value: LeadTemperature | None) -> str | None:
    return _TEMPERATURE_TO_DB.get(value) if value else None


__all__ = ["ConversationRepository", "temperature_from_db", "temperature_to_db"]
