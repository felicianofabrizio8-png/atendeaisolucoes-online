-- ============================================================================
-- FASE 4/5 — memória episódica, resumo incremental, flags e shadow mode.
--
-- Nenhuma destas tabelas existia. `conversation_sales_states` cobre parte da
-- working memory e NÃO é alterada aqui — o agente TS continua lendo dela.
-- ============================================================================

-- ---------- ai_episodic_memories ----------
-- Fatos do lead: "recusou o X por preço", "prefere parcelar", "espaço 6x3".
CREATE TABLE IF NOT EXISTS public.ai_episodic_memories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lead_id         uuid NOT NULL,
  conversation_id uuid,
  memory_type     text NOT NULL
    CHECK (memory_type IN ('preference','objection','constraint','commitment','fact','timing')),
  content         text NOT NULL CHECK (length(content) BETWEEN 1 AND 1000),
  confidence      numeric NOT NULL DEFAULT 0.7 CHECK (confidence BETWEEN 0 AND 1),
  source          text NOT NULL
    CHECK (source IN ('agent_inferred','human_confirmed','system_event')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- NULL = não expira. Memória temporal ("compra em outubro") precisa de prazo,
  -- senão guia a conversa muito depois de deixar de valer.
  expires_at      timestamptz
);

-- Índice desenhado para a consulta real: memórias válidas de um lead,
-- melhores primeiro. O WHERE parcial mantém o índice pequeno.
CREATE INDEX IF NOT EXISTS ai_episodic_memories_lookup_idx
  ON public.ai_episodic_memories (company_id, lead_id, confidence DESC, created_at DESC)
  WHERE expires_at IS NULL OR expires_at > now();

-- ---------- ai_conversation_summaries ----------
CREATE TABLE IF NOT EXISTS public.ai_conversation_summaries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  summary         text NOT NULL,
  -- Marca d'água: mensagens até aqui já entraram no resumo. É o que evita
  -- reprocessar o histórico inteiro a cada turno.
  covered_until   timestamptz NOT NULL,
  message_count   integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, conversation_id)
);

-- ---------- ai_company_flags ----------
-- Não havia tabela de feature flag no projeto (auditoria §3.4). Ativação
-- progressiva por empresa, como o briefing pediu.
CREATE TABLE IF NOT EXISTS public.ai_company_flags (
  company_id               uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  python_ai_enabled        boolean NOT NULL DEFAULT false,
  python_ai_shadow_mode    boolean NOT NULL DEFAULT false,
  python_ai_assisted_mode  boolean NOT NULL DEFAULT false,
  python_ai_automatic_mode boolean NOT NULL DEFAULT false,
  python_ai_rag_enabled    boolean NOT NULL DEFAULT false,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- ---------- ai_shadow_comparisons ----------
-- FASE 13. O agente TS e o Python decidem em paralelo; o Python não envia.
-- Sem esta tabela não há como julgar se a nova arquitetura está pronta.
CREATE TABLE IF NOT EXISTS public.ai_shadow_comparisons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id    uuid NOT NULL,
  job_id             uuid,
  trace_id           text,

  legacy_action      text,
  legacy_message_len integer,
  legacy_product_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],

  python_action      text,
  python_message_len integer,
  python_product_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  python_tools_used  text[] NOT NULL DEFAULT '{}'::text[],
  python_latency_ms  integer,

  -- Métricas de acordo, calculadas na escrita para o painel não recalcular.
  action_match       boolean,
  product_match      boolean,
  grounding_ok       boolean,

  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Guarda tamanho de mensagem, não a mensagem: comparar decisão não exige
-- duplicar conteúdo de cliente numa tabela de análise.
CREATE INDEX IF NOT EXISTS ai_shadow_comparisons_company_idx
  ON public.ai_shadow_comparisons (company_id, created_at DESC);

-- ---------- ai_action_keys ----------
-- Idempotência de ação externa. Uma repetição de job não pode gerar duas
-- mensagens nem dois orçamentos.
CREATE TABLE IF NOT EXISTS public.ai_action_keys (
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  action          text NOT NULL,
  result_id       uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, idempotency_key)
);

-- ---------- RLS ----------
ALTER TABLE public.ai_episodic_memories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversation_summaries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_company_flags           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_shadow_comparisons      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_action_keys             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_episodic_company_read ON public.ai_episodic_memories;
CREATE POLICY ai_episodic_company_read
  ON public.ai_episodic_memories FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS ai_summaries_company_read ON public.ai_conversation_summaries;
CREATE POLICY ai_summaries_company_read
  ON public.ai_conversation_summaries FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS ai_flags_company_read ON public.ai_company_flags;
CREATE POLICY ai_flags_company_read
  ON public.ai_company_flags FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

-- Comparações de shadow são material de diagnóstico: só admin.
DROP POLICY IF EXISTS ai_shadow_admin_read ON public.ai_shadow_comparisons;
CREATE POLICY ai_shadow_admin_read
  ON public.ai_shadow_comparisons FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), company_id, 'admin'::app_role));

GRANT SELECT ON public.ai_episodic_memories      TO authenticated;
GRANT SELECT ON public.ai_conversation_summaries TO authenticated;
GRANT SELECT ON public.ai_company_flags          TO authenticated;
GRANT SELECT ON public.ai_shadow_comparisons     TO authenticated;

GRANT ALL ON public.ai_episodic_memories      TO service_role;
GRANT ALL ON public.ai_conversation_summaries TO service_role;
GRANT ALL ON public.ai_company_flags          TO service_role;
GRANT ALL ON public.ai_shadow_comparisons     TO service_role;
GRANT ALL ON public.ai_action_keys            TO service_role;

DROP TRIGGER IF EXISTS ai_conversation_summaries_set_updated_at ON public.ai_conversation_summaries;
CREATE TRIGGER ai_conversation_summaries_set_updated_at
  BEFORE UPDATE ON public.ai_conversation_summaries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
