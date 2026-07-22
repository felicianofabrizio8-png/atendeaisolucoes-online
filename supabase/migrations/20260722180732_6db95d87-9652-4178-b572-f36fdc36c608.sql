
ALTER TABLE public.coach_suggestions
  ADD COLUMN IF NOT EXISTS learning_ids_used uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS learning_versions_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS learning_confidence numeric,
  ADD COLUMN IF NOT EXISTS grounding_score numeric,
  ADD COLUMN IF NOT EXISTS sources_used jsonb,
  ADD COLUMN IF NOT EXISTS domain_validation jsonb,
  ADD COLUMN IF NOT EXISTS feedback_status text,
  ADD COLUMN IF NOT EXISTS feedback_user_id uuid,
  ADD COLUMN IF NOT EXISTS feedback_created_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'coach_suggestions_feedback_status_chk'
  ) THEN
    ALTER TABLE public.coach_suggestions
      ADD CONSTRAINT coach_suggestions_feedback_status_chk
      CHECK (feedback_status IS NULL OR feedback_status IN ('positive','negative'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_coach_suggestions_feedback
  ON public.coach_suggestions(company_id, feedback_status)
  WHERE feedback_status IS NOT NULL;

-- Registra feedback do vendedor de forma segura, sempre com auth.uid()
-- e respeitando o isolamento por empresa (RLS-safe pois SELECIONA a
-- sugestão dentro da mesma company_id do profile).
CREATE OR REPLACE FUNCTION public.submit_coach_suggestion_feedback(
  _suggestion_id uuid,
  _feedback text,
  _learning_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_company uuid;
  v_sug_company uuid;
  v_current text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'coach_feedback_unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF _feedback NOT IN ('positive','negative') THEN
    RAISE EXCEPTION 'coach_feedback_invalid_status' USING ERRCODE = '22023';
  END IF;

  SELECT company_id INTO v_company FROM public.profiles WHERE id = v_user;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'coach_feedback_no_company' USING ERRCODE = '42501';
  END IF;

  SELECT company_id, feedback_status INTO v_sug_company, v_current
    FROM public.coach_suggestions
   WHERE id = _suggestion_id
   FOR UPDATE;
  IF v_sug_company IS NULL THEN
    RAISE EXCEPTION 'coach_feedback_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_sug_company <> v_company THEN
    RAISE EXCEPTION 'coach_feedback_cross_tenant' USING ERRCODE = '42501';
  END IF;

  UPDATE public.coach_suggestions
     SET feedback_status = _feedback,
         feedback_user_id = v_user,
         feedback_created_at = now(),
         learning_ids_used = CASE
            WHEN _learning_id IS NOT NULL
              AND NOT (_learning_id = ANY(learning_ids_used))
            THEN array_append(learning_ids_used, _learning_id)
            ELSE learning_ids_used
          END
   WHERE id = _suggestion_id;

  RETURN _suggestion_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_coach_suggestion_feedback(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_coach_suggestion_feedback(uuid, text, uuid) TO authenticated;
