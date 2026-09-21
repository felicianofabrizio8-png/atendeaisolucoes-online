-- ============================================================================
-- FASE 2 — role dedicada do ai-service, com RLS ativa.
--
-- POR QUE ISTO EXISTE
--
-- Hoje todo o caminho server-side do Atende Aí usa service role, que ignora
-- RLS por definição. O isolamento entre empresas é um `.eq("company_id")`
-- escrito à mão em cada query (auditoria §5). Funciona até alguém esquecer —
-- e o banco não avisa: devolve dado de outra empresa sem erro.
--
-- Esta migration dá ao Python uma role com RLS ATIVA, que lê o tenant de
-- `current_setting('app.company_id')`. O `SET LOCAL` é feito por
-- `database/connection.tenant_transaction()` a cada transação.
--
-- Resultado: um WHERE esquecido devolve zero linhas em vez de vazar.
--
-- APLICAÇÃO MANUAL
-- Criar a role e a senha fora do controle de versão:
--
--   CREATE ROLE ai_service LOGIN PASSWORD '<gerada, fora do git>';
--
-- Depois rodar esta migration. A DATABASE_URL do serviço usa esta role —
-- NUNCA a service role do Supabase e nunca a chave publishable.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_service') THEN
    RAISE EXCEPTION 'Crie a role ai_service antes (ver cabeçalho desta migration)';
  END IF;
END
$$;

-- Tenant corrente a partir da sessão. STABLE porque não muda dentro da query.
CREATE OR REPLACE FUNCTION public.ai_service_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '')::uuid
$$;

GRANT USAGE ON SCHEMA public TO ai_service;

-- Leitura do que o agente precisa aterrar.
GRANT SELECT ON
  public.products,
  public.leads,
  public.conversations,
  public.messages,
  public.conversation_sales_states,
  public.marketing_knowledge_base,
  public.ai_knowledge_proposals,
  public.coach_learnings,
  public.ai_documents,
  public.ai_document_chunks,
  public.ai_company_flags,
  public.ai_episodic_memories,
  public.ai_conversation_summaries
TO ai_service;

-- Escrita só no que o serviço é dono, mais os dois campos de estado da
-- conversa que ele mantém.
GRANT INSERT, UPDATE, DELETE ON
  public.ai_documents,
  public.ai_document_chunks,
  public.ai_episodic_memories,
  public.ai_conversation_summaries,
  public.ai_shadow_comparisons,
  public.ai_action_keys,
  public.conversation_sales_states
TO ai_service;

GRANT UPDATE ON public.conversations TO ai_service;

-- Fila: precisa ler, reivindicar e finalizar.
GRANT SELECT, INSERT, UPDATE ON public.agent_jobs TO ai_service;
GRANT EXECUTE ON FUNCTION public.dequeue_agent_job(text, text[], integer) TO ai_service;

-- Auditoria operacional continua sendo escrita (ai_flow_events não é
-- substituída pelo Langfuse — são trilhas diferentes).
GRANT INSERT ON public.ai_flow_events TO ai_service;

-- ---------- Políticas de tenant para a role ----------
-- Uma política por tabela. Sem elas, GRANT sozinho daria acesso total.
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'products','leads','conversations','messages','conversation_sales_states',
    'marketing_knowledge_base','ai_knowledge_proposals','coach_learnings',
    'ai_documents','ai_document_chunks','ai_company_flags',
    'ai_episodic_memories','ai_conversation_summaries','ai_shadow_comparisons',
    'ai_action_keys'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS ai_service_tenant ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY ai_service_tenant ON public.%I
        FOR ALL TO ai_service
        USING (company_id = public.ai_service_company_id())
        WITH CHECK (company_id = public.ai_service_company_id())
    $f$, t);
  END LOOP;
END
$$;

-- agent_jobs é a exceção deliberada: o dequeue precisa olhar todas as
-- empresas para pegar o próximo job. O company_id vem DENTRO do job e é ele
-- que cria o escopo do turno. Nenhum dado comercial é lido por aqui.
ALTER TABLE public.agent_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_service_jobs ON public.agent_jobs;
CREATE POLICY ai_service_jobs
  ON public.agent_jobs FOR ALL TO ai_service
  USING (true) WITH CHECK (true);

COMMENT ON POLICY ai_service_jobs ON public.agent_jobs IS
  'Cross-tenant por necessidade: o worker precisa reivindicar jobs de qualquer empresa. O escopo do turno vem do company_id do job.';
