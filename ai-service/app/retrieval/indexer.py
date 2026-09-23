"""Ingestão de conhecimento.

```text
documento -> normalize -> chunk -> metadata -> embedding -> ai_document_chunks
```

Regra que vem do briefing e é aplicada em `index_company_sources`: **conteúdo
não aprovado não vira conhecimento oficial**. FAQ entra só com
`status = 'approved'`; coach learning só com `status = 'active'`. O sistema de
aprendizado propõe; a indexação só publica o que passou por revisão.
"""

from __future__ import annotations

import logging
import re
from uuid import UUID

from app.database.repositories.chunks import ChunkRepository
from app.database.repositories.knowledge import KnowledgeRepository
from app.database.repositories.products import ProductRepository
from app.retrieval.embeddings import EmbeddingProvider
from app.schemas.retrieval import IndexRequest, IndexResult

logger = logging.getLogger(__name__)

CHUNK_TARGET_CHARS = 900
CHUNK_OVERLAP_CHARS = 120


def normalize(text: str) -> str:
    """Colapsa espaços e normaliza quebras. Texto colado de PDF vem cheio de
    quebra no meio da frase, e isso estraga tanto o embedding quanto o FTS."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_text(
    text: str, *, target: int = CHUNK_TARGET_CHARS, overlap: int = CHUNK_OVERLAP_CHARS
) -> list[str]:
    """Divide em pedaços com sobreposição, cortando em fronteira de parágrafo.

    A sobreposição existe para a frase que responde a pergunta não cair
    exatamente na emenda entre dois chunks e sumir das duas buscas.
    """
    text = normalize(text)
    if len(text) <= target:
        return [text] if text else []

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current = ""

    for paragraph in paragraphs:
        if len(current) + len(paragraph) + 2 <= target:
            current = f"{current}\n\n{paragraph}" if current else paragraph
            continue
        if current:
            chunks.append(current)
            tail = current[-overlap:] if overlap else ""
            current = f"{tail}\n\n{paragraph}" if tail else paragraph
        else:
            # Parágrafo sozinho maior que o alvo: corta duro, sem escolha.
            for start in range(0, len(paragraph), target):
                chunks.append(paragraph[start : start + target])
            current = ""

    if current:
        chunks.append(current)
    return chunks


async def index_document(
    request: IndexRequest,
    *,
    chunks_repo: ChunkRepository,
    embeddings: EmbeddingProvider,
) -> IndexResult:
    chunks_repo.scope.guard(request.company_id, "indexer.index_document")

    document_id = await chunks_repo.upsert_document(
        source_type=request.source_type,
        source_id=request.source_id,
        title=request.title,
        metadata=request.metadata,
    )

    removed = 0
    if request.replace_existing:
        # Apagar antes de inserir evita duplicata na reindexação. O custo é a
        # janela em que o documento fica sem chunks — aceitável porque tudo
        # acontece dentro da mesma transação.
        removed = await chunks_repo.delete_chunks(document_id)

    pieces = chunk_text(request.content)
    if not pieces:
        return IndexResult(document_id=document_id, chunks_written=0, chunks_removed=removed)

    vectors = await embeddings.embed_documents(pieces)
    written = await chunks_repo.insert_chunks(
        document_id=document_id,
        source_type=request.source_type,
        source_id=request.source_id,
        contents=pieces,
        embeddings=vectors,
        metadata=request.metadata,
    )
    return IndexResult(document_id=document_id, chunks_written=written, chunks_removed=removed)


async def index_company_sources(
    company_id: UUID,
    *,
    chunks_repo: ChunkRepository,
    knowledge_repo: KnowledgeRepository,
    products_repo: ProductRepository,
    embeddings: EmbeddingProvider,
) -> list[IndexResult]:
    """Indexa as fontes internas já existentes no Atende Aí."""
    results: list[IndexResult] = []

    policy = await knowledge_repo.get_commercial_policy()
    policy_text = "\n\n".join(
        f"{field}: {value}"
        for field, value in policy.model_dump().items()
        if isinstance(value, str) and value.strip()
    )
    if policy_text:
        results.append(
            await index_document(
                IndexRequest(
                    company_id=company_id,
                    source_type="commercial_policy",
                    title="Políticas comerciais",
                    content=policy_text,
                ),
                chunks_repo=chunks_repo,
                embeddings=embeddings,
            )
        )

    for faq in await knowledge_repo.approved_faq(limit=200):
        question = str(faq.get("question") or "").strip()
        answer = str(faq.get("answer") or "").strip()
        if not question or not answer:
            continue
        results.append(
            await index_document(
                IndexRequest(
                    company_id=company_id,
                    source_type="faq",
                    source_id=faq["id"],
                    title=question,
                    content=f"Pergunta: {question}\nResposta: {answer}",
                    metadata={"type": faq.get("type")},
                ),
                chunks_repo=chunks_repo,
                embeddings=embeddings,
            )
        )

    for learning in await knowledge_repo.active_coach_learnings(limit=200):
        results.append(
            await index_document(
                IndexRequest(
                    company_id=company_id,
                    source_type="coach_learning",
                    source_id=learning["id"],
                    title=str(learning.get("title") or ""),
                    content=str(learning.get("rule_structured") or ""),
                    metadata={
                        "category": learning.get("category"),
                        "priority": learning.get("priority"),
                    },
                ),
                chunks_repo=chunks_repo,
                embeddings=embeddings,
            )
        )

    logger.info(
        "indexação concluída",
        extra={"company_id": str(company_id), "documents": len(results)},
    )
    return results


__all__ = [
    "CHUNK_OVERLAP_CHARS",
    "CHUNK_TARGET_CHARS",
    "chunk_text",
    "index_company_sources",
    "index_document",
    "normalize",
]
