BEGIN;

ALTER TABLE public.coach_learnings
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS intent text,
  ADD COLUMN IF NOT EXISTS conflict_key text,
  ADD COLUMN IF NOT EXISTS source_training_message_id uuid;

ALTER TABLE public.ai_training_messages
  ADD COLUMN IF NOT EXISTS correction_domain text,
  ADD COLUMN IF NOT EXISTS correction_intent text,
  ADD COLUMN IF NOT EXISTS correction_conflict_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.ai_training_messages'::regclass
       AND conname = 'ai_training_messages_id_company_unique'
  ) THEN
    ALTER TABLE public.ai_training_messages ADD CONSTRAINT ai_training_messages_id_company_unique UNIQUE (id, company_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.coach_learnings'::regclass
       AND conname = 'coach_learnings_source_training_company_fk'
  ) THEN
    ALTER TABLE public.coach_learnings ADD CONSTRAINT coach_learnings_source_training_company_fk
      FOREIGN KEY (source_training_message_id, company_id)
      REFERENCES public.ai_training_messages(id, company_id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.coach_learnings'::regclass
       AND conname = 'coach_learnings_classification_consistent'
  ) THEN
    ALTER TABLE public.coach_learnings ADD CONSTRAINT coach_learnings_classification_consistent CHECK (
      (domain IS NULL AND intent IS NULL AND conflict_key IS NULL)
      OR (domain IS NOT NULL AND length(btrim(domain)) BETWEEN 1 AND 120
        AND intent IS NOT NULL AND length(btrim(intent)) BETWEEN 1 AND 120
        AND conflict_key IS NOT NULL AND length(btrim(conflict_key)) BETWEEN 1 AND 240
        AND conflict_key = btrim(conflict_key))
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.ai_training_messages'::regclass
       AND conname = 'ai_training_correction_classification_consistent'
  ) THEN
    ALTER TABLE public.ai_training_messages ADD CONSTRAINT ai_training_correction_classification_consistent CHECK (
      (correction_domain IS NULL AND correction_intent IS NULL AND correction_conflict_key IS NULL)
      OR (correction_domain IS NOT NULL AND length(btrim(correction_domain)) BETWEEN 1 AND 120
        AND correction_intent IS NOT NULL AND length(btrim(correction_intent)) BETWEEN 1 AND 120
        AND correction_conflict_key IS NOT NULL AND length(btrim(correction_conflict_key)) BETWEEN 1 AND 240
        AND correction_conflict_key = btrim(correction_conflict_key))
    );
  END IF;
END;
$$;

ALTER TABLE public.coach_rules
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS intent text,
  ADD COLUMN IF NOT EXISTS conflict_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.coach_rules'::regclass
       AND conname = 'coach_rules_classification_consistent'
  ) THEN
    ALTER TABLE public.coach_rules
      ADD CONSTRAINT coach_rules_classification_consistent CHECK (
        (domain IS NULL AND intent IS NULL AND conflict_key IS NULL)
        OR (
          domain IS NOT NULL AND length(btrim(domain)) BETWEEN 1 AND 120
          AND intent IS NOT NULL AND length(btrim(intent)) BETWEEN 1 AND 120
          AND conflict_key IS NOT NULL AND length(btrim(conflict_key)) BETWEEN 1 AND 240
          AND conflict_key = btrim(conflict_key)
        )
      );
  END IF;
END;
$$;

ALTER TABLE public.quick_replies
  ADD COLUMN IF NOT EXISTS conflict_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.quick_replies'::regclass
       AND conname = 'quick_replies_conflict_key_not_blank'
  ) THEN
    ALTER TABLE public.quick_replies ADD CONSTRAINT quick_replies_conflict_key_not_blank CHECK (
      conflict_key IS NULL OR (length(btrim(conflict_key)) BETWEEN 1 AND 240 AND conflict_key = btrim(conflict_key))
    );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS coach_learnings_company_conflict_idx
  ON public.coach_learnings (company_id, conflict_key)
  WHERE conflict_key IS NOT NULL AND status <> 'archived';

CREATE UNIQUE INDEX IF NOT EXISTS coach_learnings_one_active_conflict_idx
  ON public.coach_learnings (company_id, conflict_key)
  WHERE conflict_key IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS ai_training_messages_correction_conflict_idx
  ON public.ai_training_messages (company_id, correction_conflict_key)
  WHERE correction_conflict_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS coach_rules_company_conflict_idx
  ON public.coach_rules (company_id, conflict_key)
  WHERE conflict_key IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS quick_replies_company_conflict_idx
  ON public.quick_replies (company_id, conflict_key)
  WHERE conflict_key IS NOT NULL AND active = true;

COMMENT ON COLUMN public.coach_learnings.domain IS
  'Classificação normativa opcional; NULL preserva learnings legados sem inferência.';
COMMENT ON COLUMN public.coach_learnings.intent IS
  'Intenção normativa opcional; não é fato comercial.';
COMMENT ON COLUMN public.coach_learnings.conflict_key IS
  'Chave explícita de conflito; somente itens com chave podem ser supersedidos.';
COMMENT ON COLUMN public.coach_learnings.source_training_message_id IS
  'Proveniência opcional de correção aprovada no treinamento.';

CREATE OR REPLACE FUNCTION public.create_training_learning_candidate(_message_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_agent public.ai_training_messages;
  v_lead public.ai_training_messages;
  v_learning_id uuid;
  v_title text;
  v_rule text;
BEGIN
  IF v_company IS NULL OR NOT public.has_role(auth.uid(), v_company, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_agent FROM public.ai_training_messages
   WHERE id = _message_id AND company_id = v_company AND role = 'agent' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'training_response_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_agent.review_status <> 'corrected' OR nullif(btrim(v_agent.correction_text), '') IS NULL THEN
    RAISE EXCEPTION 'training_correction_required' USING ERRCODE = '22023';
  END IF;
  IF v_agent.promoted_learning_id IS NOT NULL THEN RETURN v_agent.promoted_learning_id; END IF;
  SELECT * INTO v_lead FROM public.ai_training_messages
   WHERE session_id = v_agent.session_id AND company_id = v_company AND role = 'lead'
     AND created_at < v_agent.created_at ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'training_lead_context_not_found' USING ERRCODE = 'P0002'; END IF;
  v_title := left('Resposta treinada: ' || btrim(v_lead.content), 120);
  v_rule := left('Quando o cliente disser algo semelhante a "' || btrim(v_lead.content)
    || '", responda de acordo com o exemplo recomendado.', 2000);
  INSERT INTO public.coach_learnings (
    company_id, category, product_ref, title, description, rule_structured,
    positive_example, negative_example, priority, confidence, taught_by, updated_by,
    source_conversation_id, source_training_message_id, domain, intent, conflict_key,
    version, status
  ) VALUES (
    v_company, 'tone', NULL, v_title,
    'Correção promovida explicitamente pelo Chat de Treinamento.', v_rule,
    left(btrim(v_agent.correction_text), 2000), left(btrim(v_agent.content), 2000),
    50, 0.7, auth.uid(), auth.uid(), NULL, v_agent.id,
    v_agent.correction_domain, v_agent.correction_intent, v_agent.correction_conflict_key,
    1, 'paused'
  ) RETURNING id INTO v_learning_id;
  INSERT INTO public.coach_learning_versions (
    learning_id, company_id, version, category, product_ref, title, description,
    rule_structured, positive_example, negative_example, priority, status, confidence,
    edited_by, origin, change_reason, prompt_version, metadata
  ) VALUES (
    v_learning_id, v_company, 1, 'tone', NULL, v_title,
    'Correção promovida explicitamente pelo Chat de Treinamento.', v_rule,
    left(btrim(v_agent.correction_text), 2000), left(btrim(v_agent.content), 2000),
    50, 'paused', 0.7, auth.uid(), 'teach_mode',
    'Candidato criado; aguardando aprovação explícita.', 'sales-training@2026-09-09',
    jsonb_build_object('training_message_id', v_agent.id)
  );
  UPDATE public.ai_training_messages SET promoted_learning_id = v_learning_id,
    learning_promotion_status = 'pending' WHERE id = v_agent.id AND company_id = v_company;
  RETURN v_learning_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'training_learning_duplicate_conflict' USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_training_learning_candidate(_message_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_agent public.ai_training_messages;
  v_learning public.coach_learnings;
  v_old public.coach_learnings;
  v_replaced_id uuid;
  v_replaced_max_priority smallint := 0;
  v_new_priority smallint;
  v_new_version integer;
BEGIN
  IF v_company IS NULL OR NOT public.has_role(auth.uid(), v_company, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_agent FROM public.ai_training_messages
   WHERE id = _message_id AND company_id = v_company AND role = 'agent' FOR UPDATE;
  IF NOT FOUND OR v_agent.promoted_learning_id IS NULL THEN
    RAISE EXCEPTION 'training_learning_candidate_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_agent.learning_promotion_status = 'approved' THEN RETURN v_agent.promoted_learning_id; END IF;
  SELECT * INTO v_learning FROM public.coach_learnings
   WHERE id = v_agent.promoted_learning_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND OR v_learning.status <> 'paused' THEN
    RAISE EXCEPTION 'training_learning_candidate_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.coach_learning_versions v
     WHERE v.learning_id = v_learning.id AND v.company_id = v_company AND v.version = 1
       AND v.status = 'paused' AND v.origin = 'teach_mode'
       AND v.metadata ->> 'training_message_id' = v_agent.id::text
  ) THEN RAISE EXCEPTION 'training_learning_candidate_invalid' USING ERRCODE = '22023'; END IF;

  IF v_learning.conflict_key IS NULL THEN
    -- Compatibilidade: preserva a supersessão histórica baseada no snapshot
    -- learning_ids_used quando o candidato ainda não tem classificação.
    FOR v_replaced_id IN
      SELECT used.value::uuid
        FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(v_agent.decision -> 'learning_ids_used') = 'array'
            THEN v_agent.decision -> 'learning_ids_used' ELSE '[]'::jsonb END
        ) AS used(value)
       WHERE used.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         AND EXISTS (
           SELECT 1 FROM public.coach_learnings l
            WHERE l.id = used.value::uuid AND l.company_id = v_company AND l.status = 'active'
         )
    LOOP
      SELECT * INTO v_old FROM public.coach_learnings
       WHERE id = v_replaced_id AND company_id = v_company AND status = 'active' FOR UPDATE;
      IF FOUND THEN
        v_replaced_max_priority := GREATEST(v_replaced_max_priority, v_old.priority);
        UPDATE public.coach_learnings SET status = 'paused', version = version + 1,
          updated_by = auth.uid() WHERE id = v_old.id;
        INSERT INTO public.coach_learning_versions (
          learning_id, company_id, version, category, product_ref, title, description,
          rule_structured, positive_example, negative_example, priority, status, confidence,
          edited_by, origin, change_reason, prompt_version, metadata
        ) VALUES (
          v_old.id, v_company, v_old.version + 1, v_old.category, v_old.product_ref,
          v_old.title, v_old.description, v_old.rule_structured, v_old.positive_example,
          v_old.negative_example, v_old.priority, 'paused', v_old.confidence, auth.uid(),
          'manual_edit', 'Supersedido por aprovação legada de treinamento.',
          'sales-training@2026-09-09', jsonb_build_object('training_message_id', v_agent.id)
        );
      END IF;
    END LOOP;
    -- O caminho legacy tambÃ©m preserva a elevaÃ§Ã£o histÃ³rica para o retrieval.
    v_new_priority := GREATEST(
      v_learning.priority,
      LEAST(100, GREATEST(90, v_replaced_max_priority + 1))
    )::smallint;
  ELSIF v_learning.conflict_key IS NOT NULL THEN
    FOR v_old IN
      SELECT * FROM public.coach_learnings
       WHERE company_id = v_company AND status = 'active'
         AND conflict_key = v_learning.conflict_key AND id <> v_learning.id
       FOR UPDATE
    LOOP
      v_replaced_max_priority := GREATEST(v_replaced_max_priority, v_old.priority);
      UPDATE public.coach_learnings SET status = 'paused', version = version + 1,
        updated_by = auth.uid() WHERE id = v_old.id;
      INSERT INTO public.coach_learning_versions (
        learning_id, company_id, version, category, product_ref, title, description,
        rule_structured, positive_example, negative_example, priority, status, confidence,
        edited_by, origin, change_reason, prompt_version, metadata
      ) VALUES (
        v_old.id, v_company, v_old.version + 1, v_old.category, v_old.product_ref,
        v_old.title, v_old.description, v_old.rule_structured, v_old.positive_example,
        v_old.negative_example, v_old.priority, 'paused', v_old.confidence, auth.uid(),
        'manual_edit', 'Supersedido por correção aprovada.', 'sales-training@2026-09-09',
        jsonb_build_object('replaced_by_learning_id', v_learning.id, 'training_message_id', v_agent.id)
      );
    END LOOP;
    v_new_priority := GREATEST(
      v_learning.priority,
      LEAST(100, GREATEST(90, v_replaced_max_priority + 1))
    )::smallint;
  END IF;
  v_new_version := v_learning.version + 1;
  UPDATE public.coach_learnings SET status = 'active', version = v_new_version,
    priority = v_new_priority,
    rule_structured = left(
      rule_structured || ' Resposta aprovada para este comportamento: '
      || btrim(v_agent.correction_text), 2000
    ), updated_by = auth.uid()
   WHERE id = v_learning.id AND company_id = v_company AND status = 'paused'
   RETURNING * INTO v_learning;
  IF NOT FOUND THEN RAISE EXCEPTION 'training_learning_candidate_invalid' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.coach_learning_versions (
    learning_id, company_id, version, category, product_ref, title, description,
    rule_structured, positive_example, negative_example, priority, status, confidence,
    edited_by, origin, change_reason, prompt_version, metadata
  ) VALUES (
    v_learning.id, v_company, v_new_version, v_learning.category, v_learning.product_ref,
    v_learning.title, v_learning.description, v_learning.rule_structured,
    v_learning.positive_example, v_learning.negative_example, v_learning.priority, 'active', v_learning.confidence,
    auth.uid(), 'manual_edit', 'Aprendizado aprovado no Chat de Treinamento.',
    'sales-training@2026-09-09', jsonb_build_object('training_message_id', v_agent.id)
  );
  UPDATE public.ai_training_messages SET learning_promotion_status = 'approved'
   WHERE id = v_agent.id AND company_id = v_company AND promoted_learning_id = v_learning.id;
  RETURN v_learning.id;
END;
$$;

COMMIT;
