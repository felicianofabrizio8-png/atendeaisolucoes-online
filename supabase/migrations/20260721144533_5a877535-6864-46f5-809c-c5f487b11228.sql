
-- =====================================================================
-- COACH V2 — FASE 2.b.1: Correções obrigatórias
--   A. Reserva atômica de user_message (idempotência sem race condition).
--   B. Evento de auditoria em coach_rule_events com linkage completo
--      quando a confirmação vier do Coach Interpreter.
--   C. Remoção do CHECK duplicado de normalized_output.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) RPC coach_reserve_user_message — atômica via ON CONFLICT DO NOTHING
--    sobre o índice único parcial coach_msg_client_req_uidx criado em
--    20260721120657.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coach_reserve_user_message(
  _conversation_id   uuid,
  _client_request_id uuid,
  _content           text
) RETURNS TABLE(message_id uuid, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_conv    public.coach_conversations;
  v_id      uuid;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'coach_no_company' USING ERRCODE = '42501';
  END IF;
  IF _client_request_id IS NULL THEN
    RAISE EXCEPTION 'coach_client_request_id_required' USING ERRCODE = '22023';
  END IF;
  IF _content IS NULL OR length(btrim(_content)) = 0 THEN
    RAISE EXCEPTION 'coach_empty_content' USING ERRCODE = '22023';
  END IF;
  IF length(_content) > 8000 THEN
    RAISE EXCEPTION 'coach_content_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_conv
    FROM public.coach_conversations
   WHERE id = _conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coach_conversation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_conv.company_id <> v_company THEN
    RAISE EXCEPTION 'coach_cross_tenant' USING ERRCODE = '42501';
  END IF;
  IF v_conv.owner_user_id IS NOT NULL
     AND v_conv.owner_user_id <> auth.uid()
     AND NOT public.has_role(auth.uid(), v_company, 'admin') THEN
    RAISE EXCEPTION 'coach_forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.coach_messages
    (company_id, conversation_id, kind, author_user_id, content,
     payload, run, client_request_id)
  VALUES
    (v_company, _conversation_id, 'user_message', auth.uid(), _content,
     '{}'::jsonb, '{}'::jsonb, _client_request_id)
  ON CONFLICT (conversation_id, client_request_id)
    WHERE client_request_id IS NOT NULL AND kind = 'user_message'
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, true;
    RETURN;
  END IF;

  -- Concorreu e perdeu — releia a mensagem existente.
  SELECT m.id INTO v_id
    FROM public.coach_messages m
   WHERE m.conversation_id = _conversation_id
     AND m.client_request_id = _client_request_id
     AND m.kind = 'user_message'
   LIMIT 1;

  IF v_id IS NULL THEN
    -- Extremamente improvável: nem inseriu nem encontrou.
    RAISE EXCEPTION 'coach_reserve_race_unresolved' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY SELECT v_id, false;
END;
$$;

REVOKE ALL ON FUNCTION public.coach_reserve_user_message(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_reserve_user_message(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.coach_reserve_user_message(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.coach_reserve_user_message(uuid, uuid, text) IS
  'Coach V2 Fase 2.b.1: reserva atômica de user_message por (conversation_id, client_request_id). Retorna (message_id, created). Duas requisições concorrentes com o mesmo par recebem o mesmo message_id; apenas uma tem created=true.';

-- ---------------------------------------------------------------------
-- B) confirm_coach_rule_proposal — adiciona evento de linkage em
--    coach_rule_events (event_type='version_created') na mesma transação.
--    Reutiliza toda a lógica da Fase 2.b (flag/ACL/idempotência).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_coach_rule_proposal(
  _proposal_id uuid,
  _overrides jsonb DEFAULT '{}'::jsonb,
  _critical_confirmed boolean DEFAULT false
) RETURNS TABLE(rule_id uuid, version_id uuid, was_already_confirmed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company   uuid := public.current_company_id();
  v_flag      boolean;
  v_row       public.coach_rule_proposals;
  v_title     text;
  v_category  public.coach_rule_category;
  v_rule_type public.coach_rule_type;
  v_scope_kind public.coach_rule_scope_kind;
  v_scope_ref jsonb;
  v_priority  smallint;
  v_instruction text;
  v_content   text;
  v_created   record;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'coach_no_company' USING ERRCODE = '42501';
  END IF;
  PERFORM public.coach_assert_admin(v_company);

  SELECT coach_interpreter_enabled INTO v_flag
    FROM public.company_settings
   WHERE company_id = v_company;
  IF v_flag IS NULL OR v_flag IS NOT TRUE THEN
    RAISE EXCEPTION 'COACH_INTERPRETER_DISABLED' USING ERRCODE = 'P0001';
  END IF;

  IF _overrides IS NULL OR jsonb_typeof(_overrides) <> 'object' THEN
    _overrides := '{}'::jsonb;
  END IF;

  SELECT * INTO v_row
    FROM public.coach_rule_proposals
   WHERE id = _proposal_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coach_proposal_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.company_id <> v_company THEN
    RAISE EXCEPTION 'coach_proposal_cross_tenant' USING ERRCODE = '42501';
  END IF;

  IF v_row.status = 'confirmed' THEN
    -- Idempotente: não cria evento novamente.
    RETURN QUERY SELECT v_row.created_rule_id, v_row.created_version_id, true;
    RETURN;
  END IF;

  IF v_row.status IN ('discarded','failed') THEN
    RAISE EXCEPTION 'coach_proposal_not_confirmable' USING ERRCODE = '22023';
  END IF;

  v_title       := COALESCE(NULLIF(btrim(_overrides->>'title'),''), v_row.title);
  v_instruction := COALESCE(NULLIF(btrim(_overrides->>'instruction'),''), v_row.instruction);
  v_priority    := COALESCE(NULLIF(_overrides->>'priority','')::smallint, v_row.priority);
  v_category    := v_row.category;
  v_rule_type   := v_row.rule_type;
  v_scope_kind  := COALESCE(
                     NULLIF(_overrides->>'scope_kind','')::public.coach_rule_scope_kind,
                     v_row.scope_kind);
  v_scope_ref   := COALESCE(_overrides->'scope_ref', v_row.scope_ref);

  IF v_scope_kind = 'agent' THEN
    RAISE EXCEPTION 'coach_scope_agent_not_supported_in_phase_2' USING ERRCODE = '22023';
  END IF;
  IF v_priority IS NULL OR v_priority < 0 OR v_priority > 100 THEN
    RAISE EXCEPTION 'coach_invalid_priority' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(v_title)) < 3 OR length(btrim(v_title)) > 120 THEN
    RAISE EXCEPTION 'coach_invalid_title' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(v_instruction)) < 3 OR length(btrim(v_instruction)) > 2000 THEN
    RAISE EXCEPTION 'coach_invalid_instruction' USING ERRCODE = '22023';
  END IF;

  IF public.coach_is_critical_category(v_category) AND _critical_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'coach_critical_confirmation_required' USING ERRCODE = '22023';
  END IF;

  v_content := v_instruction;

  SELECT * INTO v_created
    FROM public.create_coach_rule_draft(
      v_category, v_rule_type, v_title, v_content, v_priority,
      v_scope_kind, v_scope_ref, NULL, NULL
    );
  IF v_created.rule_id IS NULL OR v_created.version_id IS NULL THEN
    RAISE EXCEPTION 'coach_draft_creation_failed' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.coach_rule_proposals
     SET status             = 'confirmed',
         confirmed_at       = now(),
         confirmed_by       = auth.uid(),
         created_rule_id    = v_created.rule_id,
         created_version_id = v_created.version_id,
         title              = v_title,
         instruction        = v_instruction,
         priority           = v_priority,
         scope_kind         = v_scope_kind,
         scope_ref          = v_scope_ref,
         updated_at         = now()
   WHERE id = _proposal_id;

  -- Auditoria em coach_messages (mantida da Fase 2.b).
  INSERT INTO public.coach_messages
    (company_id, conversation_id, kind, author_user_id, content, payload, run)
  VALUES
    (v_company, v_row.conversation_id, 'confirmation_ack', auth.uid(), '',
     jsonb_build_object(
       'source',              'coach_interpreter',
       'origin',              'coach_interpreter',
       'proposal_id',         _proposal_id,
       'rule_id',             v_created.rule_id,
       'version_id',          v_created.version_id,
       'conversation_id',     v_row.conversation_id,
       'actor_user_id',       auth.uid(),
       'critical_confirmed',  COALESCE(_critical_confirmed,false),
       'category',            v_category::text,
       'rule_type',           v_rule_type::text,
       'scope_kind',          v_scope_kind::text
     ),
     '{}'::jsonb);

  -- Linkage em coach_rule_events na MESMA transação (achado M1).
  -- Usa event_type 'version_created' (existente) para não ampliar o enum.
  -- Falha no INSERT causa rollback integral da RPC.
  INSERT INTO public.coach_rule_events
    (company_id, rule_id, version_id, event_type, actor_user_id, details)
  VALUES
    (v_company, v_created.rule_id, v_created.version_id, 'version_created',
     auth.uid(),
     jsonb_build_object(
       'source',              'coach_interpreter',
       'origin',              'coach_interpreter',
       'proposal_id',         _proposal_id,
       'conversation_id',     v_row.conversation_id,
       'source_message_id',   v_row.source_message_id,
       'critical_confirmed',  COALESCE(_critical_confirmed,false),
       'category',            v_category::text,
       'rule_type',           v_rule_type::text,
       'scope_kind',          v_scope_kind::text
     ));

  RETURN QUERY SELECT v_created.rule_id, v_created.version_id, false;
END;
$$;

COMMENT ON FUNCTION public.confirm_coach_rule_proposal(uuid, jsonb, boolean) IS
  'Coach V2 Fase 2.b.1: além da Fase 2.b, emite evento version_created em coach_rule_events com proposal_id/conversation_id/source=coach_interpreter na mesma transação. Idempotência preservada (evento não é duplicado em confirmações repetidas).';

-- ---------------------------------------------------------------------
-- C) Remove CHECK duplicado de normalized_output.
--    O CHECK inline auto-nomeado (coach_rule_proposals_normalized_output_check)
--    validava apenas jsonb_typeof=object. O constraint consolidado
--    coach_prop_normalized_output_size (Fase 2.b) já cobre esse caso
--    E o limite de 16 KB.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  -- Precondição: o constraint consolidado precisa existir e estar validado.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'coach_prop_normalized_output_size'
       AND conrelid = 'public.coach_rule_proposals'::regclass
       AND convalidated = true
  ) THEN
    RAISE EXCEPTION 'coach_prop_normalized_output_size ausente ou não validado — abort DROP redundante';
  END IF;
END $$;

ALTER TABLE public.coach_rule_proposals
  DROP CONSTRAINT IF EXISTS coach_rule_proposals_normalized_output_check;
