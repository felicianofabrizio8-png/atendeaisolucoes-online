-- ============================================================================
-- SPRINT 4 · FASE 3 — Trace do ranking contextual (não destrutivo).
-- ============================================================================

-- 1) Colunas de trace. JSONB controlado em vez de N colunas prematuras.
ALTER TABLE public.coach_learning_retrievals
  ADD COLUMN IF NOT EXISTS ranking_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS final_score numeric(6,2);

COMMENT ON COLUMN public.coach_learning_retrievals.ranking_metadata IS
  'Trace explicável do ranking: {finalScore, matchedReasons[], penalties[], strategy}. Nunca contém mensagem nem prompt.';

-- 2) Índices de suporte à busca de candidatos (ampliada de 5 para até 50).
CREATE INDEX IF NOT EXISTS coach_learnings_company_active_priority
  ON public.coach_learnings (company_id, priority DESC, updated_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS coach_learning_retrievals_generation_ref
  ON public.coach_learning_retrievals (generation_ref);

-- 3) RPC interna passa a aceitar o trace por aprendizado.
--    DROP + CREATE evita ambiguidade de overload com o default antigo.
DROP FUNCTION IF EXISTS public.record_coach_learning_retrieval_internal(uuid, uuid[], text, uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.record_coach_learning_retrieval_internal(
  _company_id       uuid,
  _ids              uuid[],
  _generation_ref   text,
  _conversation_id  uuid    DEFAULT NULL,
  _message_id       uuid    DEFAULT NULL,
  _selection_reason text    DEFAULT 'priority_static',
  _ranking          jsonb   DEFAULT '[]'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted integer := 0;
BEGIN
  -- Guardas: sem empresa, sem ids ou sem chave de idempotência → no-op.
  IF _company_id IS NULL
     OR _ids IS NULL
     OR array_length(_ids, 1) IS NULL
     OR _generation_ref IS NULL
     OR length(btrim(_generation_ref)) = 0 THEN
    RETURN 0;
  END IF;

  IF _ranking IS NULL OR jsonb_typeof(_ranking) <> 'array' THEN
    _ranking := '[]'::jsonb;
  END IF;

  WITH ordered AS (
    -- A ordem do array define o rank quando o trace não informa um.
    SELECT id, ordinality::smallint AS ord
      FROM unnest(_ids) WITH ORDINALITY AS t(id, ordinality)
  ),
  meta AS (
    SELECT (e->>'learning_id')::uuid              AS learning_id,
           NULLIF(e->>'rank','')::smallint        AS rank,
           NULLIF(e->>'final_score','')::numeric  AS final_score,
           NULLIF(e->>'selection_reason','')      AS selection_reason,
           (e - 'learning_id')                    AS payload
      FROM jsonb_array_elements(_ranking) AS e
     WHERE (e->>'learning_id') IS NOT NULL
  ),
  valid AS (
    -- Isolamento por empresa validado no banco, mesmo sob service_role.
    SELECT o.id, o.ord, l.version, m.rank, m.final_score,
           m.selection_reason, m.payload
      FROM ordered o
      JOIN public.coach_learnings l
        ON l.id = o.id AND l.company_id = _company_id
      LEFT JOIN meta m ON m.learning_id = o.id
  ),
  ins AS (
    INSERT INTO public.coach_learning_retrievals (
      company_id, learning_id, version_number, generation_ref,
      conversation_id, message_id, rank, selection_reason,
      final_score, ranking_metadata
    )
    SELECT _company_id, v.id, v.version, _generation_ref,
           _conversation_id, _message_id,
           COALESCE(v.rank, v.ord),
           COALESCE(v.selection_reason, _selection_reason),
           v.final_score,
           COALESCE(v.payload, '{}'::jsonb)
      FROM valid v
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

REVOKE ALL ON FUNCTION public.record_coach_learning_retrieval_internal(uuid, uuid[], text, uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_coach_learning_retrieval_internal(uuid, uuid[], text, uuid, uuid, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_coach_learning_retrieval_internal(uuid, uuid[], text, uuid, uuid, text, jsonb) TO service_role;