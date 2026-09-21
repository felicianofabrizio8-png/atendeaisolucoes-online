"""Conhecimento oficial e chunks indexados.

Duas fontes distintas, com níveis de confiança diferentes:

- **oficial** (`ai_knowledge_proposals` aprovadas, `marketing_knowledge_base`):
  é verdade da empresa. Pode fundamentar preço, política e condição.
- **aprendido** (`coach_learnings` ativos): é orientação de estilo e tática.
  Nunca substitui fato oficial — a regra vem do briefing e está reforçada em
  `retrieval/reranker.py`, que dá prioridade menor a esta fonte.
"""

from __future__ import annotations

from typing import Any

from app.database.repositories.base import TenantRepository
from app.schemas.tools import CommercialPolicy


class KnowledgeRepository(TenantRepository):
    async def get_company_name(self) -> str | None:
        """Nome da empresa, usado no system prompt do agente.

        `id` é a coluna de tenant em `companies` — por isso o guard confere
        `id`, não `company_id`, e a query filtra pela chave primária.
        """
        row = await self._fetch_one(
            "SELECT id, name FROM public.companies WHERE id = %s LIMIT 1",
            (self.company_id,),
        )
        if row is None:
            return None
        self._scope.guard(row.get("id"), "knowledge.get_company_name")
        return row.get("name")

    async def get_commercial_policy(self) -> CommercialPolicy:
        """Políticas oficiais. Campos ausentes viram None e o agente deve
        dizer que não sabe — ver `schemas/tools.CommercialPolicy`."""
        sql = """
            SELECT company_id, commercial_terms, payment_policy,
                   installation_policy, visit_policy, heating_policy,
                   shipping_policy, included_items_policy
              FROM public.marketing_knowledge_base
             WHERE company_id = %s
             LIMIT 1
        """
        row = await self._fetch_one(sql, (self.company_id,))
        row = self._guard_row(row, "knowledge.get_commercial_policy")
        if row is None:
            return CommercialPolicy()
        return CommercialPolicy.model_validate(row)

    async def approved_faq(self, limit: int = 20) -> list[dict[str, Any]]:
        """FAQ aprovada. O filtro `status = 'approved'` é o mesmo do agente TS
        (`sales-agent-grounding.server.ts:901-903`) — conteúdo não aprovado
        não vira conhecimento oficial."""
        sql = """
            SELECT id, company_id, question, answer, type
              FROM public.ai_knowledge_proposals
             WHERE company_id = %s AND status = 'approved'
             ORDER BY created_at DESC
             LIMIT %s
        """
        rows = await self._fetch_all(sql, (self.company_id, limit))
        return self._guard_rows(rows, "knowledge.approved_faq")

    async def active_coach_learnings(self, limit: int = 12) -> list[dict[str, Any]]:
        sql = """
            SELECT id, company_id, title, description, rule_structured,
                   category, priority, confidence
              FROM public.coach_learnings
             WHERE company_id = %s AND status = 'active'
             ORDER BY priority DESC, confidence DESC
             LIMIT %s
        """
        rows = await self._fetch_all(sql, (self.company_id, limit))
        return self._guard_rows(rows, "knowledge.active_coach_learnings")


__all__ = ["KnowledgeRepository"]
