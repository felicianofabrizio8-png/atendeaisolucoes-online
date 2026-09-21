"""Leads.

`update_state` só aceita campos de qualificação. Mudança de `status` do funil
NÃO passa por aqui de propósito: é ação comercial e precisa do Policy Engine,
então mora em `tools/leads.py` como ação de escrita.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from app.database.repositories.base import TenantRepository
from app.schemas.tools import LeadSnapshot, LeadStateUpdate


class LeadRepository(TenantRepository):
    async def get(self, lead_id: UUID) -> LeadSnapshot | None:
        sql = """
            SELECT id, company_id, name, status, product_id,
                   estimated_value, created_at
              FROM public.leads
             WHERE company_id = %s AND id = %s
             LIMIT 1
        """
        row = await self._fetch_one(sql, (self.company_id, lead_id))
        row = self._guard_row(row, "leads.get")
        if row is None:
            return None
        value = row.get("estimated_value")
        return LeadSnapshot.model_validate(
            {**row, "estimated_value": Decimal(str(value)) if value is not None else None}
        )

    async def update_state(self, conversation_id: UUID, update: LeadStateUpdate) -> int:
        """Atualiza a qualificação detectada na conversa.

        Só grava campo não-nulo: o agente reporta o que observou neste turno, e
        um None significa "não observei agora", não "apague o que havia".
        Sobrescrever com NULL apagaria a cidade que o cliente informou três
        mensagens atrás.
        """
        fields: dict[str, Any] = {
            "detected_city": update.detected_city,
            "detected_state": update.detected_state,
            "detected_budget": update.detected_budget,
            "detected_intent": update.detected_intent,
            "purchase_timing": update.purchase_timing,
        }
        present = {k: v for k, v in fields.items() if v is not None}
        if update.objections is not None:
            present["detected_objections"] = update.objections
        if not present:
            return 0

        assignments = ", ".join(f"{col} = %s" for col in present)
        sql = f"""
            UPDATE public.conversations
               SET {assignments}
             WHERE company_id = %s AND id = %s
        """
        return await self._execute(sql, (*present.values(), self.company_id, conversation_id))


__all__ = ["LeadRepository"]
