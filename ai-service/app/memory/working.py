"""Working memory — estado da conversa atual.

Remonta um modelo único a partir das **duas** fontes que o Atende Aí já usa
(auditoria §3.2):

- `conversation_sales_states`: produto corrente, candidatos, intenção;
- `conversations`: cidade, estado, orçamento, prazo, objeções, estágio.

Escreve de volta nas duas. Unificar fisicamente as tabelas seria mais limpo,
mas quebraria o agente TS que lê de lá — e ele precisa continuar funcionando
durante toda a migração. A unificação fica para depois do shadow mode.

É esta camada que permite responder "sim", "esse", "o segundo" sem reenviar o
histórico inteiro ao modelo a cada turno.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.database.repositories.conversations import ConversationRepository
from app.schemas.agent import ScopeType
from app.schemas.memory import WorkingMemory


def _as_uuid_list(value: Any) -> list[UUID]:
    if not isinstance(value, list):
        return []
    out: list[UUID] = []
    for item in value:
        try:
            out.append(item if isinstance(item, UUID) else UUID(str(item)))
        except (ValueError, AttributeError, TypeError):
            continue
    return out


def _as_str_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v) for v in value if v]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


async def load(
    repo: ConversationRepository,
    *,
    scope_type: ScopeType,
    scope_id: UUID,
    conversation_id: UUID,
) -> WorkingMemory:
    state = await repo.get_sales_state(scope_type, scope_id) or {}
    conversation = await repo.get(conversation_id) or {}
    attributes: dict[str, Any] = state.get("attributes") or {}

    return WorkingMemory(
        company_id=repo.company_id,
        scope_type=scope_type,
        scope_id=scope_id,
        intent=state.get("intent") or conversation.get("detected_intent"),
        stage=conversation.get("customer_stage"),
        current_product_id=(_as_uuid_list(state.get("product_ids")) or [None])[0],
        candidate_product_ids=_as_uuid_list(state.get("product_ids")),
        last_valid_product_ids=_as_uuid_list(state.get("last_valid_product_ids")),
        budget=conversation.get("detected_budget"),
        city=conversation.get("detected_city"),
        state=conversation.get("detected_state"),
        purchase_timing=conversation.get("purchase_timing"),
        objections=_as_str_list(conversation.get("detected_objections")),
        # Estes três não têm coluna própria em lugar nenhum; ficam no jsonb
        # `attributes`, que é o campo livre que a tabela já oferece.
        last_question=attributes.get("last_question"),
        pending_action=attributes.get("pending_action"),
        missing_information=_as_str_list(attributes.get("missing_information")),
        updated_at=state.get("updated_at"),
    )


async def save(repo: ConversationRepository, memory: WorkingMemory) -> None:
    """Persiste o estado.

    Só mexe em `conversation_sales_states`. A parte que vive em `conversations`
    é escrita por `tools/leads.update_lead_state`, que passa pelo Policy
    Engine — qualificação é dado comercial, não estado de sessão.
    """
    repo.scope.guard(memory.company_id, "working_memory.save")

    candidates = memory.candidate_product_ids
    if memory.current_product_id and memory.current_product_id not in candidates:
        candidates = [memory.current_product_id, *candidates]

    await repo.upsert_sales_state(
        scope_type=memory.scope_type,
        scope_id=memory.scope_id,
        intent=memory.intent,
        product_ids=candidates,
        # Só promove a "último válido" quando há candidatos agora. Uma busca
        # que não achou nada não pode apagar a memória do que o cliente já
        # estava vendo — senão "esse mesmo" deixa de resolver.
        last_valid_product_ids=candidates or memory.last_valid_product_ids,
        attributes={
            "last_question": memory.last_question,
            "pending_action": memory.pending_action,
            "missing_information": memory.missing_information,
        },
    )


__all__ = ["load", "save"]
