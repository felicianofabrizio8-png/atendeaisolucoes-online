
-- =====================================================================
-- Coach V2 — Fase 2.b Hardening
-- Corrige os 3 achados MÉDIOS da auditoria READ-ONLY da Fase 2.a:
--   (1) confirm_coach_rule_proposal não validava a feature flag
--       coach_interpreter_enabled.
--   (2) Rastreabilidade da origem (proposal_id, conversation_id,
--       source='coach_interpreter', critical_confirmed) só existia
--       parcialmente no coach_messages 'confirmation_ack'.
--   (3) normalized_output não tinha limite de tamanho.
--
-- Também adiciona idempotência client-side de coach_messages
-- (Parte 11) e revoga privilégios residuais de anon.
--
-- Decisão de design para o achado (2): Alternativa B do briefing
--   (evento já existente com payload enriquecido). O evento em
--   coach_rule_events segue sendo 'rule_created' emitido por
--   create_coach_rule_draft; a rastreabilidade fim-a-fim ocorre em
--   coach_messages.confirmation_ack, cujo payload passa a conter
--   { source: 'coach_interpreter', origin, proposal_id, rule_id,
--     version_id, conversation_id, critical_confirmed, actor_user_id }.
--   Isso evita ampliar o enum coach_rule_event_type (proibido pela
--   auditoria) e evita duplicar rule_created no coach_rule_events.
-- =====================================================================

-- 1) Limite de tamanho em normalized_output (16 KB).
ALTER TABLE public.coach_rule_proposals
  DROP CONSTRAINT IF EXISTS coach_prop_normalized_output_size;
ALTER TABLE public.coach_rule_proposals
  ADD CONSTRAINT coach_prop_normalized_output_size CHECK (
    normalized_output IS NULL
    OR (
      jsonb_typeof(normalized_output) = 'object'
      AND octet_length(normalized_output::text) <= 16384
    )
  );

-- 2) Idempotência de mensagens (Parte 11): client_request_id
ALTER TABLE public.coach_messages
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

-- Índice único parcial: só user_message tem idempotência client-side.
CREATE UNIQUE INDEX IF NOT EXISTS coach_msg_client_req_uidx
  ON public.coach_messages (conversation_id, client_request_id)
  WHERE client_request_id IS NOT NULL AND kind = 'user_message';

-- 3) REVOKE residual em anon (defesa em profundidade — RLS já bloqueia,
--    mas removemos privilégios DML herdados do PUBLIC/anon).
REVOKE INSERT, UPDATE, DELETE ON public.coach_conversations FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.coach_messages FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.coach_rule_proposals FROM anon;

-- 4) confirm_coach_rule_proposal — nova versão com:
--    - validação da feature flag coach_interpreter_enabled;
--    - payload de confirmation_ack enriquecido com source/origin/actor
--      para rastreabilidade fim-a-fim.
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

  -- === Feature flag guard (achado 1) ===
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

  -- === Auditoria enriquecida (achado 2) ===
  INSERT INTO public.coach_messages
    (company_id, conversation_id, kind, author_user_id, content, payload, run)
  VALUES
    (v_company,
     v_row.conversation_id,
     'confirmation_ack',
     auth.uid(),
     '',
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

  RETURN QUERY SELECT v_created.rule_id, v_created.version_id, false;
END;
$$;

COMMENT ON FUNCTION public.confirm_coach_rule_proposal(uuid, jsonb, boolean) IS
  'Coach V2 Fase 2.b: valida feature flag coach_interpreter_enabled, é admin-only, idempotente, atômica, e emite confirmation_ack com source=coach_interpreter para rastreabilidade fim-a-fim.';
