CREATE OR REPLACE FUNCTION public.create_coach_learning(_category text, _title text, _description text, _rule_structured text, _product_ref text DEFAULT NULL::text, _positive_example text DEFAULT NULL::text, _negative_example text DEFAULT NULL::text, _priority smallint DEFAULT 50, _confidence numeric DEFAULT 0.7, _source_conversation_id uuid DEFAULT NULL::uuid, _origin text DEFAULT 'teach_mode'::text, _prompt_version text DEFAULT NULL::text, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public.current_company_id();
  v_id uuid;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'coach_learning_no_company' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(_title)) < 3 THEN
    RAISE EXCEPTION 'coach_learning_invalid_title' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(_rule_structured)) < 3 THEN
    RAISE EXCEPTION 'coach_learning_invalid_rule' USING ERRCODE = '22023';
  END IF;
  IF _origin NOT IN ('teach_mode','manual_edit','restore','migration','system') THEN
    RAISE EXCEPTION 'coach_learning_invalid_origin' USING ERRCODE = '22023';
  END IF;

  -- HOTFIX FK 23503: se o caller enviar um id que não pertence a coach_conversations
  -- da mesma empresa, tratamos como vínculo inválido e persistimos sem FK (NULL)
  -- em vez de derrubar a gravação inteira do aprendizado.
  IF _source_conversation_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.coach_conversations c
      WHERE c.id = _source_conversation_id
        AND c.company_id = v_company
    ) THEN
      _source_conversation_id := NULL;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.coach_learnings (
      company_id, category, product_ref, title, description, rule_structured,
      positive_example, negative_example, priority, confidence,
      taught_by, updated_by, source_conversation_id, version, status
    ) VALUES (
      v_company, _category, _product_ref, _title, _description, _rule_structured,
      _positive_example, _negative_example,
      GREATEST(0, LEAST(100, COALESCE(_priority, 50))),
      GREATEST(0, LEAST(1, COALESCE(_confidence, 0.7))),
      auth.uid(), auth.uid(), _source_conversation_id, 1, 'active'
    ) RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'learning_duplicate_conflict' USING ERRCODE = 'P0001';
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'invalid_source_conversation' USING ERRCODE = '23503';
  END;

  INSERT INTO public.coach_learning_versions (
    learning_id, company_id, version, category, product_ref, title, description,
    rule_structured, positive_example, negative_example, priority, status,
    confidence, edited_by, origin, change_reason, prompt_version, metadata
  ) VALUES (
    v_id, v_company, 1, _category, _product_ref, _title, _description,
    _rule_structured, _positive_example, _negative_example,
    GREATEST(0, LEAST(100, COALESCE(_priority, 50))), 'active',
    GREATEST(0, LEAST(1, COALESCE(_confidence, 0.7))), auth.uid(),
    _origin, NULL, _prompt_version, COALESCE(_metadata, '{}'::jsonb)
  );

  RETURN v_id;
END;
$function$;

-- Arquiva o registro de diagnóstico criado durante a investigação do 23503.
UPDATE public.coach_learnings
SET status = 'archived', updated_at = now()
WHERE id = '7477456a-703a-48af-85e5-3cb9b31eb716'
  AND title = 'DIAG piloto — 8m retangulares';