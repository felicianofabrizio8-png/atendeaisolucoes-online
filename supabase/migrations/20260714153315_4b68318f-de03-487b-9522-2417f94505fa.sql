
-- Índice auxiliar para expiração
CREATE INDEX IF NOT EXISTS idx_runtime_knowledge_envelopes_expires_at
  ON public.runtime_knowledge_envelopes (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_runtime_knowledge_envelopes_key_created
  ON public.runtime_knowledge_envelopes (company_id, topic, agent_id, created_at DESC);

-- Função de limpeza segura
CREATE OR REPLACE FUNCTION public.runtime_cleanup_learning_and_knowledge()
RETURNS TABLE(envelopes_removed bigint, cycles_removed bigint, tenants_processed bigint, duration_ms bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_env_removed bigint := 0;
  v_cyc_removed bigint := 0;
  v_tenants bigint := 0;
BEGIN
  -- 1) Remove envelopes expirados, PRESERVANDO o mais recente por (company, topic, agent)
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY company_id, topic, agent_id ORDER BY created_at DESC, id DESC) AS rn
      FROM public.runtime_knowledge_envelopes
  ),
  del AS (
    DELETE FROM public.runtime_knowledge_envelopes e
     USING ranked r
     WHERE e.id = r.id
       AND r.rn > 1
       AND e.expires_at IS NOT NULL
       AND e.expires_at < now()
    RETURNING e.company_id
  )
  SELECT COUNT(*) INTO v_env_removed FROM del;

  -- 2) Ciclos: manter 90 dias
  WITH del AS (
    DELETE FROM public.runtime_learning_cycles
     WHERE created_at < now() - interval '90 days'
    RETURNING company_id
  )
  SELECT COUNT(*) INTO v_cyc_removed FROM del;

  -- 3) Ciclos: manter no máximo 5000 por tenant (mais recentes)
  WITH ranked AS (
    SELECT id, company_id,
           ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY created_at DESC, id DESC) AS rn
      FROM public.runtime_learning_cycles
  ),
  del AS (
    DELETE FROM public.runtime_learning_cycles c
     USING ranked r
     WHERE c.id = r.id
       AND r.rn > 5000
    RETURNING c.company_id
  )
  SELECT v_cyc_removed + COUNT(*) INTO v_cyc_removed FROM del;

  SELECT COUNT(DISTINCT company_id) INTO v_tenants
    FROM (
      SELECT company_id FROM public.runtime_learning_cycles
      UNION
      SELECT company_id FROM public.runtime_knowledge_envelopes
    ) t;

  RETURN QUERY SELECT
    v_env_removed,
    v_cyc_removed,
    v_tenants,
    (EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000)::bigint;
END;
$$;

REVOKE ALL ON FUNCTION public.runtime_cleanup_learning_and_knowledge() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_cleanup_learning_and_knowledge() TO service_role;

-- Agendamento pg_cron a cada 30 minutos (idempotente)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'runtime-cleanup-learning-knowledge') THEN
    PERFORM cron.unschedule('runtime-cleanup-learning-knowledge');
  END IF;
  PERFORM cron.schedule(
    'runtime-cleanup-learning-knowledge',
    '*/30 * * * *',
    $cron$
      SELECT public.runtime_cleanup_learning_and_knowledge();
    $cron$
  );
END $$;
