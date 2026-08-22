BEGIN;

ALTER TABLE public.ai_training_messages
  ADD COLUMN IF NOT EXISTS promoted_learning_id uuid,
  ADD COLUMN IF NOT EXISTS learning_promotion_status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.ai_training_messages'::regclass
       AND conname = 'ai_training_messages_promoted_learning_fkey'
  ) THEN
    ALTER TABLE public.ai_training_messages
      ADD CONSTRAINT ai_training_messages_promoted_learning_fkey
      FOREIGN KEY (promoted_learning_id)
      REFERENCES public.coach_learnings(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.ai_training_messages'::regclass
       AND conname = 'ai_training_messages_learning_promotion_status_check'
  ) THEN
    ALTER TABLE public.ai_training_messages
      ADD CONSTRAINT ai_training_messages_learning_promotion_status_check
      CHECK (
        learning_promotion_status IS NULL
        OR learning_promotion_status IN ('pending', 'approved')
      );
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS ai_training_messages_promoted_learning_uniq
  ON public.ai_training_messages (promoted_learning_id)
  WHERE promoted_learning_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_training_learning_candidate(
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
  v_lead public.ai_training_messages;
  v_learning_id uuid;
  v_title text;
  v_rule text;
BEGIN
  IF v_company IS NULL
     OR NOT public.has_role(
       auth.uid(),
       v_company,
       'admin'::public.app_role
     )
  THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_agent
    FROM public.ai_training_messages
   WHERE id = _message_id
     AND company_id = v_company
     AND role = 'agent'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'training_response_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_agent.review_status <> 'corrected'
     OR nullif(btrim(v_agent.correction_text), '') IS NULL
  THEN
    RAISE EXCEPTION 'training_correction_required'
      USING ERRCODE = '22023';
  END IF;

  IF v_agent.promoted_learning_id IS NOT NULL THEN
    RETURN v_agent.promoted_learning_id;
  END IF;

  SELECT *
    INTO v_lead
    FROM public.ai_training_messages
   WHERE session_id = v_agent.session_id
     AND company_id = v_company
     AND role = 'lead'
     AND created_at < v_agent.created_at
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'training_lead_context_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  v_title := left(
    'Resposta treinada: ' || btrim(v_lead.content),
    120
  );

  v_rule := left(
    'Quando o cliente disser algo semelhante a "'
    || btrim(v_lead.content)
    || '", responda de acordo com o exemplo recomendado.',
    2000
  );

  BEGIN
    INSERT INTO public.coach_learnings (
      company_id,
      category,
      product_ref,
      title,
      description,
      rule_structured,
      positive_example,
      negative_example,
      priority,
      confidence,
      taught_by,
      updated_by,
      source_conversation_id,
      version,
      status
    )
    VALUES (
      v_company,
      'tone',
      NULL,
      v_title,
      'Correção promovida explicitamente pelo Chat de Treinamento.',
      v_rule,
      left(btrim(v_agent.correction_text), 2000),
      left(btrim(v_agent.content), 2000),
      50,
      0.7,
      auth.uid(),
      auth.uid(),
      NULL,
      1,
      'paused'
    )
    RETURNING id INTO v_learning_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'training_learning_duplicate_conflict'
        USING ERRCODE = 'P0001';
  END;

  INSERT INTO public.coach_learning_versions (
    learning_id,
    company_id,
    version,
    category,
    product_ref,
    title,
    description,
    rule_structured,
    positive_example,
    negative_example,
    priority,
    status,
    confidence,
    edited_by,
    origin,
    change_reason,
    prompt_version,
    metadata
  )
  VALUES (
    v_learning_id,
    v_company,
    1,
    'tone',
    NULL,
    v_title,
    'Correção promovida explicitamente pelo Chat de Treinamento.',
    v_rule,
    left(btrim(v_agent.correction_text), 2000),
    left(btrim(v_agent.content), 2000),
    50,
    'paused',
    0.7,
    auth.uid(),
    'teach_mode',
    'Candidato criado; aguardando aprovação explícita.',
    'sales-training@2026-08-22',
    jsonb_build_object(
      'training_message_id',
      v_agent.id
    )
  );

  UPDATE public.ai_training_messages
     SET promoted_learning_id = v_learning_id,
         learning_promotion_status = 'pending'
   WHERE id = v_agent.id
     AND company_id = v_company;

  RETURN v_learning_id;
END;
$$;

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
BEGIN
  IF v_company IS NULL
     OR NOT public.has_role(
       auth.uid(),
       v_company,
       'admin'::public.app_role
     )
  THEN
    RAISE EXCEPTION 'admin_required'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_agent
    FROM public.ai_training_messages
   WHERE id = _message_id
     AND company_id = v_company
     AND role = 'agent'
   FOR UPDATE;

  IF NOT FOUND
     OR v_agent.promoted_learning_id IS NULL
  THEN
    RAISE EXCEPTION 'training_learning_candidate_not_found'
      USING ERRCODE = 'P0002';
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

  IF NOT FOUND
     OR v_learning.status <> 'paused'
  THEN
    RAISE EXCEPTION 'training_learning_candidate_invalid'
      USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'training_learning_candidate_invalid'
      USING ERRCODE = '22023';
  END IF;

  v_new_version := v_learning.version + 1;

  UPDATE public.coach_learnings
     SET status = 'active',
         version = v_new_version,
         updated_by = auth.uid()
   WHERE id = v_learning.id
     AND company_id = v_company
     AND status = 'paused';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'training_learning_candidate_invalid'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.coach_learning_versions (
    learning_id,
    company_id,
    version,
    category,
    product_ref,
    title,
    description,
    rule_structured,
    positive_example,
    negative_example,
    priority,
    status,
    confidence,
    edited_by,
    origin,
    change_reason,
    prompt_version,
    metadata
  )
  VALUES (
    v_learning.id,
    v_company,
    v_new_version,
    v_learning.category,
    v_learning.product_ref,
    v_learning.title,
    v_learning.description,
    v_learning.rule_structured,
    v_learning.positive_example,
    v_learning.negative_example,
    v_learning.priority,
    'active',
    v_learning.confidence,
    auth.uid(),
    'manual_edit',
    'Aprendizado aprovado explicitamente no Chat de Treinamento.',
    'sales-training@2026-08-22',
    jsonb_build_object(
      'training_message_id',
      v_agent.id
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

REVOKE ALL
  ON FUNCTION public.create_training_learning_candidate(uuid)
  FROM PUBLIC;

REVOKE ALL
  ON FUNCTION public.approve_training_learning_candidate(uuid)
  FROM PUBLIC;

REVOKE ALL
  ON FUNCTION public.create_training_learning_candidate(uuid)
  FROM anon;

REVOKE ALL
  ON FUNCTION public.approve_training_learning_candidate(uuid)
  FROM anon;

GRANT EXECUTE
  ON FUNCTION public.create_training_learning_candidate(uuid)
  TO authenticated;

GRANT EXECUTE
  ON FUNCTION public.approve_training_learning_candidate(uuid)
  TO authenticated;

COMMIT;
