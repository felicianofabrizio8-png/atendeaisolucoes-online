"""Dependências injetadas nas ferramentas.

O agente recebe este objeto via `RunContext.deps` do Pydantic AI e **não tem
outro caminho para o mundo**. Não há cliente de banco, `httpx` solto nem
variável global acessível de dentro de uma tool: tudo que uma ferramenta pode
tocar está aqui dentro, já com escopo de empresa amarrado.

Isso é o que dá sentido à frase "o agente não acessa tabelas diretamente":
não é convenção, é a única superfície disponível.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

from app.database.repositories.chunks import ChunkRepository
from app.database.repositories.conversations import ConversationRepository
from app.database.repositories.knowledge import KnowledgeRepository
from app.database.repositories.leads import LeadRepository
from app.database.repositories.memory import MemoryRepository
from app.database.repositories.products import ProductRepository
from app.policies.execution import ExecutionContext
from app.policies.tenant import TenantScope
from app.retrieval.embeddings import EmbeddingProvider
from app.retrieval.reranker import Reranker
from app.schemas.agent import ToolInvocation


@dataclass(slots=True)
class AgentDeps:
    scope: TenantScope
    execution: ExecutionContext

    conversation_id: UUID
    lead_id: UUID | None

    products: ProductRepository
    leads: LeadRepository
    conversations: ConversationRepository
    knowledge: KnowledgeRepository
    memory: MemoryRepository
    chunks: ChunkRepository

    embeddings: EmbeddingProvider
    reranker: Reranker

    # Chave base de idempotência do turno. Cada ação externa deriva a sua a
    # partir daqui, então reprocessar o mesmo job não gera dois orçamentos.
    idempotency_base: str = ""

    # Rastro do que o agente chamou. Vira `tool_calls_used` na decisão e é a
    # evidência de aterramento que os evals medem.
    invocations: list[ToolInvocation] = field(default_factory=list)

    def record(self, name: str, *, ok: bool, duration_ms: int, error_code: str | None = None) -> None:
        self.invocations.append(
            ToolInvocation(name=name, ok=ok, duration_ms=duration_ms, error_code=error_code)
        )

    def tool_names(self) -> list[str]:
        return [i.name for i in self.invocations]

    def action_key(self, action: str) -> str:
        """Chave idempotente por ação dentro do turno."""
        return f"{self.idempotency_base}:{action}"


__all__ = ["AgentDeps"]
