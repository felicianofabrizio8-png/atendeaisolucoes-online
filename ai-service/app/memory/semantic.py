"""Memória semântica — conhecimento geral da empresa.

É a camada mais fina do pacote de propósito: o armazenamento é o pgvector
(`retrieval/`), então aqui só mora a fachada que o agente usa e o resumo
incremental da conversa.

Sobre o resumo: o agente TS reenvia as últimas 20 mensagens a cada turno
(`sales-agent-core.ts:1082`). Numa conversa longa isso é caro e ainda assim
perde o começo — justamente onde o cliente disse o que queria. Resumo
incremental resolve os dois: `summary anterior + novas mensagens = novo
summary`, sem reprocessar o histórico inteiro.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from app.database.repositories.chunks import ChunkRepository
from app.database.repositories.memory import MemoryRepository
from app.llm import gateway
from app.llm.routing import ModelClass
from app.retrieval import hybrid_search
from app.retrieval.embeddings import EmbeddingProvider
from app.retrieval.reranker import Reranker
from app.schemas.agent import ConversationMessage
from app.schemas.memory import ConversationSummary
from app.schemas.retrieval import RetrievalFilters, RetrievalQuery, RetrievalResult

SUMMARY_PROMPT = (
    "Você mantém o resumo de um atendimento comercial. Atualize o resumo "
    "anterior com as novas mensagens.\n\n"
    "Regras:\n"
    "- Preserve fatos concretos: medidas, cidade, orçamento, prazo, produto "
    "de interesse, objeções e compromissos assumidos.\n"
    "- Não invente nada que não esteja no texto.\n"
    "- Máximo 8 linhas.\n"
    "- Português do Brasil, tom neutro."
)


async def search(
    chunks_repo: ChunkRepository,
    query_text: str,
    *,
    embeddings: EmbeddingProvider,
    reranker: Reranker,
    filters: RetrievalFilters | None = None,
    top_k: int = 5,
) -> RetrievalResult:
    return await hybrid_search.search(
        chunks_repo,
        RetrievalQuery(
            text=query_text, filters=filters or RetrievalFilters(), top_k=top_k
        ),
        embeddings=embeddings,
        reranker=reranker,
    )


async def update_summary(
    repo: MemoryRepository,
    *,
    conversation_id: UUID,
    new_messages: list[ConversationMessage],
) -> ConversationSummary | None:
    """Recalcula o resumo só com o que ainda não entrou.

    Devolve None quando não há mensagem nova — o caminho mais comum num turno
    já resumido, e que não deve gastar chamada de LLM.
    """
    if not new_messages:
        return None

    previous = await repo.get_summary(conversation_id)
    cutoff = previous.covered_until if previous else None

    pending = [
        m
        for m in new_messages
        if m.created_at is not None and (cutoff is None or m.created_at > cutoff)
    ]
    if not pending:
        return None

    transcript = "\n".join(
        f"{'Cliente' if m.role == 'lead' else 'Atendente'}: {m.text}" for m in pending
    )
    result = await gateway.complete(
        [
            {"role": "system", "content": SUMMARY_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Resumo anterior:\n{previous.summary if previous else '(ainda não há)'}"
                    f"\n\nNovas mensagens:\n{transcript}"
                ),
            },
        ],
        model_class=ModelClass.FAST,
        temperature=0.1,
    )

    covered = max(
        (m.created_at for m in pending if m.created_at is not None),
        default=datetime.now(UTC),
    )
    summary = ConversationSummary(
        company_id=repo.company_id,
        conversation_id=conversation_id,
        summary=result.text.strip(),
        covered_until=covered,
        message_count=(previous.message_count if previous else 0) + len(pending),
    )
    await repo.upsert_summary(summary)
    return summary


__all__ = ["SUMMARY_PROMPT", "search", "update_summary"]
