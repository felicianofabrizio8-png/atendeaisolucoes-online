BEGIN;

-- Aprovar uma correção é uma substituição explícita: apenas os learnings que
-- participaram da resposta corrigida são pausados. O texto da correção continua
-- sendo salvo separadamente e a criação do candidato continua produzindo paused.
CREATE OR REPLACE FUNCTION public.approve_training_learning_candidate(
  _message_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_agent public.ai_training_messages;
  v_learning public.coach_learnings;
  v_new_version integer;
  v_replaced_ids uuid[] := '{}'::uuid[];
  v_replaced_max_priority smallint := 0;
  v_new_priority smallint;
BEGIN
  IF v_company IS NULL
     OR NOT public.has_role(auth.uid(), v_company, 'admin'::public.app_role)
  THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_agent
    FROM public.ai_training_messages
   WHERE id = _message_id
     AND company_id = v_company
     AND role = 'agent'
   FOR UPDATE;

  IF NOT FOUND OR v_agent.promoted_learning_id IS NULL THEN
    RAISE EXCEPTION 'training_learning_candidate_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_agent.learning_promotion_status = 'approved' THEN
    RETURN v_agent.promoted_learning_id;
  END IF;

  SELECT *
    INTO v_learning
    FROM public.coach_learnings
   WHERE id = v_agent.promoted_learning_id
     AND company_id = v_company
   FOR UPDATE;

  IF NOT FOUND OR v_learning.status <> 'paused' THEN
    RAISE EXCEPTION 'training_learning_candidate_invalid' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.coach_learning_versions v
     WHERE v.learning_id = v_learning.id
       AND v.company_id = v_company
       AND v.version = 1
       AND v.status = 'paused'
       AND v.origin = 'teach_mode'
       AND v.metadata ->> 'training_message_id' = v_agent.id::text
  ) THEN
    RAISE EXCEPTION 'training_learning_candidate_invalid' USING ERRCODE = '22023';
  END IF;

  -- A decision da resposta é o snapshot imutável de quais regras entraram no
  -- prompt. IDs inválidos, de outro tenant, já pausados ou o próprio candidato
  -- são ignorados; portanto learnings não relacionados nunca são afetados.
  SELECT
    COALESCE(array_agg(DISTINCT l.id), '{}'::uuid[]),
    COALESCE(max(l.priority), 0)::smallint
    INTO v_replaced_ids, v_replaced_max_priority
    FROM public.coach_learnings l
   WHERE l.company_id = v_company
     AND l.status = 'active'
     AND l.id <> v_learning.id
     AND l.id IN (
       SELECT used.value::uuid
         FROM jsonb_array_elements_text(
           CASE
             WHEN jsonb_typeof(v_agent.decision -> 'learning_ids_used') = 'array'
               THEN v_agent.decision -> 'learning_ids_used'
             ELSE '[]'::jsonb
           END
         ) AS used(value)
        WHERE used.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     );

  -- Garante entrada no pré-filtro por prioridade sem ultrapassar o domínio.
  v_new_priority := GREATEST(
    v_learning.priority,
    LEAST(100, GREATEST(90, v_replaced_max_priority + 1))
  )::smallint;

  WITH replaced AS (
    UPDATE public.coach_learnings l
       SET status = 'paused',
           version = l.version + 1,
           updated_by = auth.uid()
     WHERE l.company_id = v_company
       AND l.status = 'active'
       AND l.id = ANY(v_replaced_ids)
     RETURNING l.*
  )
  INSERT INTO public.coach_learning_versions (
    learning_id, company_id, version, category, product_ref, title, description,
    rule_structured, positive_example, negative_example, priority, status,
    confidence, edited_by, origin, change_reason, prompt_version, metadata
  )
  SELECT
    r.id, r.company_id, r.version, r.category, r.product_ref, r.title, r.description,
    r.rule_structured, r.positive_example, r.negative_example, r.priority, 'paused',
    r.confidence, auth.uid(), 'manual_edit',
    'Substituído por correção aprovada no Chat de Treinamento.',
    'sales-training@2026-08-24',
    jsonb_build_object(
      'training_message_id', v_agent.id,
      'replaced_by_learning_id', v_learning.id
    )
  FROM replaced r;

  v_new_version := v_learning.version + 1;

  UPDATE public.coach_learnings
     SET status = 'active',
         priority = v_new_priority,
         rule_structured = left(
           v_learning.rule_structured
           || ' Resposta aprovada para este comportamento: '
           || btrim(v_agent.correction_text),
           2000
         ),
         version = v_new_version,
         updated_by = auth.uid()
   WHERE id = v_learning.id
     AND company_id = v_company
     AND status = 'paused'
  RETURNING * INTO v_learning;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'training_learning_candidate_invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.coach_learning_versions (
    learning_id, company_id, version, category, product_ref, title, description,
    rule_structured, positive_example, negative_example, priority, status,
    confidence, edited_by, origin, change_reason, prompt_version, metadata
  ) VALUES (
    v_learning.id, v_company, v_new_version, v_learning.category,
    v_learning.product_ref, v_learning.title, v_learning.description,
    v_learning.rule_structured, v_learning.positive_example,
    v_learning.negative_example, v_learning.priority, 'active', v_learning.confidence,
    auth.uid(), 'manual_edit',
    'Aprendizado aprovado e substituições aplicadas no Chat de Treinamento.',
    'sales-training@2026-08-24',
    jsonb_build_object(
      'training_message_id', v_agent.id,
      'replaces_learning_ids', to_jsonb(v_replaced_ids)
    )
  );

  UPDATE public.ai_training_messages
     SET learning_promotion_status = 'approved'
   WHERE id = v_agent.id
     AND company_id = v_company
     AND promoted_learning_id = v_learning.id;

  RETURN v_learning.id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_training_learning_candidate(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_training_learning_candidate(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_training_learning_candidate(uuid) TO authenticated;

COMMIT;
