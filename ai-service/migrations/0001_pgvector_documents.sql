-- ============================================================================
-- FASE 5 — pgvector, documentos e chunks.
--
-- Não existia NADA de vetorial no projeto (auditoria §1.3: zero ocorrências de
-- vector/embedding/hnsw nas 158 migrations). Isto é construção do zero.
--
-- ATENÇÃO À DIMENSÃO: vector(1536) casa com text-embedding-3-small. Trocar o
-- modelo de embedding depois exige ALTER TYPE e reindexação completa de todos
-- os chunks de todas as empresas. Decidir antes de indexar em produção.
--
-- Multi-tenant: company_id é NOT NULL em tudo e entra em todo índice. A
-- auditoria §5 explica por que isso não é redundante — o plano server-side não
-- é protegido por RLS.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------- ai_documents ----------
CREATE TABLE IF NOT EXISTS public.ai_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source_type  text NOT NULL,
  source_id    uuid,
  title        text,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(metadata) = 'object')
);

-- Reindexar a mesma fonte tem que atualizar, não duplicar. É este índice que
-- torna o ON CONFLICT do indexer possível.
-- COALESCE porque UNIQUE ignora linhas com NULL, e source_id é nulo para
-- documentos sem origem em tabela (ex.: políticas comerciais consolidadas).
CREATE UNIQUE INDEX IF NOT EXISTS ai_documents_source_uniq
  ON public.ai_documents (company_id, source_type, COALESCE(source_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS ai_documents_company_idx
  ON public.ai_documents (company_id, source_type);

-- ---------- ai_document_chunks ----------
CREATE TABLE IF NOT EXISTS public.ai_document_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_id  uuid NOT NULL REFERENCES public.ai_documents(id) ON DELETE CASCADE,
  source_type  text NOT NULL,
  source_id    uuid,
  chunk_index  integer NOT NULL DEFAULT 0,
  content      text NOT NULL,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding    vector(1536),
  -- Coluna gerada: o FTS acompanha o content sem trigger e sem risco de
  -- ficar dessincronizado numa atualização.
  content_tsv  tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(metadata) = 'object')
);

-- Perna vetorial. HNSW porque a carga é leitura constante e escrita rara
-- (reindexação pontual), que é exatamente onde ele ganha do IVFFlat — e não
-- exige treinar índice com volume mínimo de linhas.
CREATE INDEX IF NOT EXISTS ai_document_chunks_embedding_idx
  ON public.ai_document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Perna léxica.
CREATE INDEX IF NOT EXISTS ai_document_chunks_tsv_idx
  ON public.ai_document_chunks USING gin (content_tsv);

-- Filtro de tenant + tipo, usado nas duas pernas.
CREATE INDEX IF NOT EXISTS ai_document_chunks_company_idx
  ON public.ai_document_chunks (company_id, source_type);

CREATE INDEX IF NOT EXISTS ai_document_chunks_document_idx
  ON public.ai_document_chunks (document_id);

-- ---------- RLS ----------
ALTER TABLE public.ai_documents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_document_chunks  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_documents_company_read ON public.ai_documents;
CREATE POLICY ai_documents_company_read
  ON public.ai_documents FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS ai_document_chunks_company_read ON public.ai_document_chunks;
CREATE POLICY ai_document_chunks_company_read
  ON public.ai_document_chunks FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

GRANT SELECT ON public.ai_documents       TO authenticated;
GRANT SELECT ON public.ai_document_chunks TO authenticated;
GRANT ALL    ON public.ai_documents       TO service_role;
GRANT ALL    ON public.ai_document_chunks TO service_role;

-- Reaproveita o trigger de updated_at já existente no projeto.
DROP TRIGGER IF EXISTS ai_documents_set_updated_at ON public.ai_documents;
CREATE TRIGGER ai_documents_set_updated_at
  BEFORE UPDATE ON public.ai_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS ai_document_chunks_set_updated_at ON public.ai_document_chunks;
CREATE TRIGGER ai_document_chunks_set_updated_at
  BEFORE UPDATE ON public.ai_document_chunks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
