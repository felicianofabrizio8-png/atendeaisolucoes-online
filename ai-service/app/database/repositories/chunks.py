"""Documentos e chunks vetoriais (`ai_documents` / `ai_document_chunks`).

Aqui mora a busca híbrida no nível de SQL. As duas pernas são consultas
separadas de propósito — merge e rerank acontecem em Python
(`retrieval/hybrid_search.py`), onde dá para inspecionar as notas parciais e
trocar o reranker sem mexer em SQL.

`company_id = %s` aparece nas duas pernas. É a linha mais importante do
arquivo: sem ela, um chunk de outra empresa entra no contexto do modelo e vira
resposta.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.database.repositories.base import TenantRepository


class ChunkRepository(TenantRepository):
    async def semantic_search(
        self,
        embedding: list[float],
        *,
        limit: int,
        source_types: list[str] | None = None,
        product_id: UUID | None = None,
    ) -> list[dict[str, Any]]:
        """Perna vetorial. `<=>` é distância cosseno no pgvector — menor é
        melhor, então a nota vira `1 - distância`."""
        sql = """
            SELECT c.id, c.company_id, c.document_id, c.source_type, c.source_id,
                   c.content, c.metadata, c.created_at,
                   1 - (c.embedding <=> %s::vector) AS semantic_score
              FROM public.ai_document_chunks c
             WHERE c.company_id = %s
               AND c.embedding IS NOT NULL
               AND (%s::text[] IS NULL OR c.source_type = ANY(%s))
               AND (%s::uuid  IS NULL OR c.source_id = %s)
             ORDER BY c.embedding <=> %s::vector
             LIMIT %s
        """
        rows = await self._fetch_all(
            sql,
            (
                embedding,
                self.company_id,
                source_types,
                source_types,
                product_id,
                product_id,
                embedding,
                limit,
            ),
        )
        return self._guard_rows(rows, "chunks.semantic_search")

    async def keyword_search(
        self,
        query: str,
        *,
        limit: int,
        source_types: list[str] | None = None,
        product_id: UUID | None = None,
    ) -> list[dict[str, Any]]:
        """Perna léxica (FTS português).

        Indispensável no domínio: SKU, modelo, medida ("6x3"), litragem e
        código não sobrevivem a embedding. Busca vetorial pura erra justamente
        as perguntas mais objetivas do cliente.
        """
        sql = """
            SELECT c.id, c.company_id, c.document_id, c.source_type, c.source_id,
                   c.content, c.metadata, c.created_at,
                   ts_rank(c.content_tsv, websearch_to_tsquery('portuguese', %s))
                     AS keyword_score
              FROM public.ai_document_chunks c
             WHERE c.company_id = %s
               AND c.content_tsv @@ websearch_to_tsquery('portuguese', %s)
               AND (%s::text[] IS NULL OR c.source_type = ANY(%s))
               AND (%s::uuid  IS NULL OR c.source_id = %s)
             ORDER BY keyword_score DESC
             LIMIT %s
        """
        rows = await self._fetch_all(
            sql,
            (
                query,
                self.company_id,
                query,
                source_types,
                source_types,
                product_id,
                product_id,
                limit,
            ),
        )
        return self._guard_rows(rows, "chunks.keyword_search")

    async def upsert_document(
        self,
        *,
        source_type: str,
        source_id: UUID | None,
        title: str | None,
        metadata: dict[str, Any],
    ) -> UUID:
        import json

        sql = """
            INSERT INTO public.ai_documents
                (company_id, source_type, source_id, title, metadata)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (company_id, source_type, source_id)
            DO UPDATE SET title = EXCLUDED.title,
                          metadata = EXCLUDED.metadata,
                          updated_at = now()
            RETURNING id
        """
        row = await self._fetch_one(
            sql, (self.company_id, source_type, source_id, title, json.dumps(metadata))
        )
        assert row is not None
        return row["id"]

    async def delete_chunks(self, document_id: UUID) -> int:
        return await self._execute(
            """
            DELETE FROM public.ai_document_chunks
             WHERE company_id = %s AND document_id = %s
            """,
            (self.company_id, document_id),
        )

    async def insert_chunks(
        self,
        *,
        document_id: UUID,
        source_type: str,
        source_id: UUID | None,
        contents: list[str],
        embeddings: list[list[float]],
        metadata: dict[str, Any],
    ) -> int:
        """Insere os chunks de um documento.

        `executemany` em vez de laço: são dezenas de linhas por documento e um
        round-trip por chunk deixaria a indexação lenta sem motivo.
        """
        import json

        if len(contents) != len(embeddings):
            raise ValueError("contents e embeddings com tamanhos diferentes")

        payload = json.dumps(metadata)
        rows = [
            (
                self.company_id,
                document_id,
                source_type,
                source_id,
                content,
                payload,
                embedding,
                index,
            )
            for index, (content, embedding) in enumerate(zip(contents, embeddings, strict=True))
        ]
        sql = """
            INSERT INTO public.ai_document_chunks
                (company_id, document_id, source_type, source_id,
                 content, metadata, embedding, chunk_index)
            VALUES (%s, %s, %s, %s, %s, %s, %s::vector, %s)
        """
        async with self._conn.cursor() as cur:
            await cur.executemany(sql, rows)  # type: ignore[arg-type]
        return len(rows)


__all__ = ["ChunkRepository"]
