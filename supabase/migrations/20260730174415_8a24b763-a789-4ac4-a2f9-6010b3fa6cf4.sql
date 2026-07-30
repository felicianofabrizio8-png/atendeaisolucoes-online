-- ============================================================================
-- SPRINT 4 · FASE 2 — Telemetria do Coach Evolutivo (service-role safe)
--
-- Causa raiz: increment_coach_learning_usage / record_coach_learning_retrieval
-- resolvem o tenant via current_company_id() -> auth.uid(). A rota
-- /api/coach/suggest roda com service role (auth.uid() = NULL), então ambas
-- retornavam 0 silenciosamente.
--
-- Correção: variantes _internal que recebem company_id explicitamente,
-- executáveis SOMENTE por service_role. As RPCs públicas permanecem intactas.
-- Migration 100% aditiva — nenhum DROP, nenhum dado alterado.
-- ============================================================================

-- 1) Colunas aditivas (todas nullable / com default) -------------------------
ALTER TABLE public.coach_learning_retrievals
  ADD COLUMN IF NOT EXISTS rank             smallint,
  ADD COLUMN IF NOT EXISTS selection_reason text,
  ADD COLUMN IF NOT EXISTS message_id       uuid,
  ADD COLUMN IF NOT EXISTS usage_counted    boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.coach_learning_retrievals.rank IS
  'Posição (1-based) do aprendizado no bloco de grounding daquela geração.';
COMMENT ON COLUMN public.coach_learning_retrievals.selection_reason IS
  'Motivo determinístico da seleção. Fase 2: sempre "priority_static".';
COMMENT ON COLUMN public.coach_learning_retrievals.usage_counted IS
  'Ledger de idempotência: true quando usage_count já foi incrementado para esta retrieval.';

-- 2) Retrieval interno (service-role) ----------------------------------------
CREATE OR REPLACE FUNCTION public.record_coach_learning_retrieval_internal(
  _company_id       uuid,
  _ids              uuid[],
  _generation_ref   text,
  _conversation_id  uuid    DEFAULT NULL,
  _message_id       uuid    DEFAULT NULL,
  _selection_reason text    DEFAULT 'priority_static'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted integer := 0;
BEGIN
  -- Lista vazia / parâmetros ausentes: no-op silencioso, nunca erro.
  IF _company_id IS NULL
     OR _ids IS NULL
     OR array_length(_ids, 1) IS NULL
     OR _generation_ref IS NULL
     OR length(btrim(_generation_ref)) = 0 THEN
    RETURN 0;
  END IF;

  WITH ranked AS (
    -- rank derivado da ORDEM do array recebido (ordem do bloco de grounding).
    SELECT t.id, t.ord
      FROM unnest(_ids) WITH ORDINALITY AS t(id, ord)
  ),
  valid_ids AS (
    -- Isolamento: só aprendizados que pertencem à empresa informada.
    -- IDs de outra empresa são simplesmente ignorados (sem erro, sem vazamento).
    SELECT l.id, l.version, r.ord
      FROM public.coach_learnings l
      JOIN ranked r ON r.id = l.id
     WHERE l.company_id = _company_id
  ),
  ins AS (
    INSERT INTO public.coach_learning_retrievals (
      company_id, learning_id, version_number, generation_ref,
      conversation_id, message_id, rank, selection_reason
    )
    SELECT _company_id, v.id, v.version, _generation_ref,
           _conversation_id, _message_id,
           LEAST(v.ord, 32767)::smallint,
           COALESCE(NULLIF(btrim(_selection_reason), ''), 'priority_static')
      FROM valid_ids v
    ON CONFLICT (learning_id, generation_ref) DO NOTHING
    RETURNING learning_id
  ),
  upd AS (
    UPDATE public.coach_learnings
       SET times_retrieved   = times_retrieved + 1,
           last_retrieved_at = now()
     WHERE id IN (SELECT learning_id FROM ins)
       AND company_id = _company_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  RETURN COALESCE(v_inserted, 0);
END;
$function$;

COMMENT ON FUNCTION public.record_coach_learning_retrieval_internal(uuid, uuid[], text, uuid, uuid, text) IS
  'Telemetria de retrieval para backend service-role. company_id explícito e validado contra coach_learnings. Idempotente por (learning_id, generation_ref). Somente service_role.';

REVOKE ALL ON FUNCTION public.record_coach_learning_retrieval_internal(uuid, uuid[], text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_coach_learning_retrieval_internal(uuid, uuid[], text, uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.record_coach_learning_retrieval_internal(uuid, uuid[], text, uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_coach_learning_retrieval_internal(uuid, uuid[], text, uuid, uuid, text) TO service_role;

-- 3) Incremento de uso interno (service-role) --------------------------------
CREATE OR REPLACE FUNCTION public.increment_coach_learning_usage_internal(
  _company_id     uuid,
  _ids            uuid[],
  _generation_ref text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  IF _company_id IS NULL
     OR _ids IS NULL
     OR array_length(_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  IF _generation_ref IS NOT NULL AND length(btrim(_generation_ref)) > 0 THEN
    -- Caminho idempotente: usa coach_learning_retrievals como ledger.
    -- Só conta uso para retrievals ainda não contabilizadas desta geração.
    -- Um retry da mesma sugestão encontra usage_counted = true e não recontabiliza.
    WITH claimed AS (
      UPDATE public.coach_learning_retrievals r
         SET usage_counted = true
       WHERE r.generation_ref = _generation_ref
         AND r.company_id     = _company_id
         AND r.learning_id    = ANY(_ids)
         AND r.usage_counted  = false
      RETURNING r.learning_id
    ),
    upd AS (
      UPDATE public.coach_learnings l
         SET usage_count  = l.usage_count + 1,
             last_used_at = now()
       WHERE l.id IN (SELECT learning_id FROM claimed)
         AND l.company_id = _company_id
         AND l.status = 'active'
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM upd;
  ELSE
    -- Sem generation_ref: comportamento direto (não idempotente), mantendo
    -- paridade com a RPC pública.
    WITH upd AS (
      UPDATE public.coach_learnings l
         SET usage_count  = l.usage_count + 1,
             last_used_at = now()
       WHERE l.id = ANY(_ids)
         AND l.company_id = _company_id
         AND l.status = 'active'
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_count FROM upd;
  END IF;

  RETURN COALESCE(v_count, 0);
END;
$function$;

COMMENT ON FUNCTION public.increment_coach_learning_usage_internal(uuid, uuid[], text) IS
  'Incremento de usage_count/last_used_at para backend service-role. company_id explícito. Idempotente quando generation_ref é informado. Somente service_role.';

REVOKE ALL ON FUNCTION public.increment_coach_learning_usage_internal(uuid, uuid[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_coach_learning_usage_internal(uuid, uuid[], text) FROM anon;
REVOKE ALL ON FUNCTION public.increment_coach_learning_usage_internal(uuid, uuid[], text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_coach_learning_usage_internal(uuid, uuid[], text) TO service_role;