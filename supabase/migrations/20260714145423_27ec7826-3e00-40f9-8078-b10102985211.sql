-- =============================================================================
-- Etapa 18: ciclo de vida persistente dos jobs do Runtime
-- =============================================================================

-- 1) claim_agent_job(_job_id, _worker_id, _lock_seconds)
--    Reserva atômica por ID (o RuntimeWorker.process recebe jobId concreto).
--    Estados possíveis de retorno:
--      status='processing' AND locked_by=_worker_id -> claim OK
--      status='completed'  -> already_completed (não modificar)
--      status='processing' AND locked_by<>_worker_id -> already_processing
--      status='failed'/'cancelled'/'dead_letter' -> não elegível
CREATE OR REPLACE FUNCTION public.claim_agent_job(
  _job_id uuid,
  _worker_id text,
  _lock_seconds integer DEFAULT 300
) RETURNS TABLE (
  claimed boolean,
  reason text,
  job public.agent_jobs
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.agent_jobs;
BEGIN
  SELECT * INTO v_row FROM public.agent_jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::text, NULL::public.agent_jobs;
    RETURN;
  END IF;

  IF v_row.status = 'completed' THEN
    RETURN QUERY SELECT false, 'already_completed'::text, v_row;
    RETURN;
  END IF;
  IF v_row.status = 'processing' THEN
    IF v_row.locked_by IS DISTINCT FROM _worker_id
       AND v_row.available_at > now() THEN
      RETURN QUERY SELECT false, 'already_processing'::text, v_row;
      RETURN;
    END IF;
    -- Lock expirado ou mesmo worker: reentrada permitida.
  ELSIF v_row.status NOT IN ('pending') THEN
    RETURN QUERY SELECT false, ('not_claimable:' || v_row.status)::text, v_row;
    RETURN;
  END IF;

  UPDATE public.agent_jobs
     SET status       = 'processing',
         attempts     = attempts + CASE WHEN v_row.status = 'pending' THEN 1 ELSE 0 END,
         locked_at    = now(),
         locked_by    = _worker_id,
         started_at   = COALESCE(started_at, now()),
         available_at = now() + make_interval(secs => GREATEST(1, _lock_seconds))
   WHERE id = _job_id
   RETURNING * INTO v_row;

  RETURN QUERY SELECT true, 'claimed'::text, v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_agent_job(uuid, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.claim_agent_job(uuid, text, integer) FROM PUBLIC, anon, authenticated;

-- 2) peek_agent_job_status: leitura leve para idempotência do worker
CREATE OR REPLACE FUNCTION public.peek_agent_job_status(_job_id uuid)
RETURNS TABLE (status text, locked_by text, attempts integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT status::text, locked_by, attempts
    FROM public.agent_jobs WHERE id = _job_id;
$$;

GRANT EXECUTE ON FUNCTION public.peek_agent_job_status(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.peek_agent_job_status(uuid) FROM PUBLIC, anon, authenticated;

-- 3) Reconciliação do job da Etapa 17B (evidência: dedupe+lock+resposta 200 completed)
UPDATE public.agent_jobs
   SET status       = 'completed',
       started_at   = COALESCE(started_at, '2026-07-14 14:47:12.400117+00'::timestamptz),
       finished_at  = COALESCE(finished_at, '2026-07-14 14:47:13.523939+00'::timestamptz),
       attempts     = GREATEST(attempts, 1),
       last_error   = NULL,
       locked_at    = NULL,
       locked_by    = NULL
 WHERE id = '496576c3-8938-4aef-9055-416beac6c222'
   AND status = 'pending';

INSERT INTO public.audit_log (company_id, user_id, action, entity, entity_id, before, after)
VALUES (
  '3a7e989c-2e1c-425d-8fc6-0feecbeb48fd', NULL,
  'runtime_execution_reconciled', 'agent_jobs',
  '496576c3-8938-4aef-9055-416beac6c222',
  jsonb_build_object('status','pending'),
  jsonb_build_object('status','completed','reason','stage_17b_worker_missing_persistence','evidence',jsonb_build_object('dedupe',true,'lock',true,'endpoint_response','execution_ok','processing_ms',903))
);