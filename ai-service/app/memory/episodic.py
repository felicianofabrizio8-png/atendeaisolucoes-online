"""Memória episódica — fatos daquele lead.

Exemplos do briefing: "recusou o produto X por preço", "prefere parcelamento",
"pretende comprar em outubro", "tem espaço de 6x3", "pediu retorno na sexta".

Dois cuidados que valem comentário:

1. **Validade.** Memória de intenção temporal expira. "Pretende comprar em
   outubro" não pode guiar a conversa em dezembro, então `expires_at` é
   obrigatório para `timing` e `commitment`.

2. **Confiança por origem.** O que o humano confirmou vale mais do que o que
   o modelo inferiu. Sem isso, uma inferência errada num turno contamina todos
   os turnos seguintes com o mesmo peso de um fato verificado.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from app.database.repositories.memory import MemoryRepository
from app.schemas.memory import EpisodicMemory, MemorySource, MemoryType

# Teto de confiança por origem.
SOURCE_CONFIDENCE_CAP: dict[MemorySource, float] = {
    "human_confirmed": 1.0,
    "system_event": 0.9,
    "agent_inferred": 0.7,
}

DEFAULT_TTL: dict[MemoryType, timedelta | None] = {
    "timing": timedelta(days=120),
    "commitment": timedelta(days=45),
    "objection": timedelta(days=180),
    "preference": None,
    "constraint": None,
    "fact": None,
}

MAX_MEMORIES_IN_CONTEXT = 8


def build(
    *,
    company_id: UUID,
    lead_id: UUID,
    conversation_id: UUID | None,
    memory_type: MemoryType,
    content: str,
    source: MemorySource,
    confidence: float,
    now: datetime | None = None,
) -> EpisodicMemory:
    now = now or datetime.now(UTC)
    capped = min(confidence, SOURCE_CONFIDENCE_CAP[source])
    ttl = DEFAULT_TTL.get(memory_type)
    return EpisodicMemory(
        company_id=company_id,
        lead_id=lead_id,
        conversation_id=conversation_id,
        memory_type=memory_type,
        content=content.strip(),
        confidence=capped,
        source=source,
        expires_at=now + ttl if ttl else None,
    )


async def recall(
    repo: MemoryRepository,
    lead_id: UUID,
    *,
    now: datetime | None = None,
    limit: int = MAX_MEMORIES_IN_CONTEXT,
) -> list[EpisodicMemory]:
    return await repo.list_episodic(lead_id, now=now or datetime.now(UTC), limit=limit)


async def remember(repo: MemoryRepository, memory: EpisodicMemory) -> UUID:
    return await repo.add_episodic(memory)


def to_context(memories: list[EpisodicMemory]) -> str:
    """Formata para o prompt.

    A confiança aparece no texto de propósito: o modelo precisa saber que
    "0,60" é inferência e pode ser confrontada, não fato fechado.
    """
    if not memories:
        return ""
    lines = [
        f"- [{m.memory_type}, confiança {m.confidence:.2f}] {m.content}" for m in memories
    ]
    return "O que já sabemos deste cliente:\n" + "\n".join(lines)


__all__ = [
    "DEFAULT_TTL",
    "MAX_MEMORIES_IN_CONTEXT",
    "SOURCE_CONFIDENCE_CAP",
    "build",
    "recall",
    "remember",
    "to_context",
]
