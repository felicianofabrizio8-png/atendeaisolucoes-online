-- ============================================================================
-- COACH V2 — PHASE 2: Coach Interpreter (dark / feature-flag OFF by default)
-- Creates the conversational surface + proposal store + atomic confirm RPC.
-- Uses the Phase 1 foundation without modifying it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Feature flag (per-tenant), starts OFF for every company.
-- ---------------------------------------------------------------------------
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS coach_interpreter_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.company_settings.coach_interpreter_enabled IS
  'Coach V2 Phase 2 feature flag. Manual activation only (pilot: Solário Piscinas).';

-- ---------------------------------------------------------------------------
-- 1. coach_conversations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coach_conversations (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_user_id uuid NULL     REFERENCES auth.users(id)        ON DELETE SET NULL,
  title         text NULL CHECK (title IS NULL OR length(btrim(title)) BETWEEN 1 AND 160),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN (
                  'open','interpreting','needs_clarification','proposal_ready',
                  'awaiting_confirmation','confirmed_partial','closed','failed'
                )),
  last_message_at timestamptz NULL,
  prompt_version  text NULL CHECK (prompt_version IS NULL OR length(prompt_version) <= 120),
  model_name      text NULL CHECK (model_name    IS NULL OR length(model_name)    <= 120),
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb
                  CHECK (jsonb_typeof(meta) = 'object'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz NULL,
  CONSTRAINT coach_conversations_id_company_uk UNIQUE (id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_coach_conversations_company_recent
  ON public.coach_conversations (company_id, last_message_at DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coach_conversations_company_status
  ON public.coach_conversations (company_id, status);
CREATE INDEX IF NOT EXISTS idx_coach_conversations_owner
  ON public.coach_conversations (company_id, owner_user_id);

GRANT SELECT, INSERT, UPDATE ON public.coach_conversations TO authenticated;
GRANT ALL                    ON public.coach_conversations TO service_role;

ALTER TABLE public.coach_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY coach_conv_select
  ON public.coach_conversations FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND (owner_user_id = auth.uid()
         OR public.has_role(auth.uid(), company_id, 'admin'))
  );

CREATE POLICY coach_conv_insert
  ON public.coach_conversations FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_company_id()
    AND owner_user_id = auth.uid()
  );

CREATE POLICY coach_conv_update
  ON public.coach_conversations FOR UPDATE TO authenticated
  USING (
    company_id = public.current_company_id()
    AND (owner_user_id = auth.uid()
         OR public.has_role(auth.uid(), company_id, 'admin'))
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND (owner_user_id = auth.uid()
         OR public.has_role(auth.uid(), company_id, 'admin'))
  );

-- No DELETE policy — soft-close via status='closed' only.

CREATE TRIGGER tg_coach_conv_updated
  BEFORE UPDATE ON public.coach_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER tg_coach_conv_no_tenant_change
  BEFORE UPDATE ON public.coach_conversations
  FOR EACH ROW EXECUTE FUNCTION public.coach_prevent_company_change();

-- ---------------------------------------------------------------------------
-- 2. coach_messages (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coach_messages (
  id              uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id      uuid NOT NULL,
  conversation_id uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN (
                     'user_message','assistant_message','system_message',
                     'clarification_request','proposal_snapshot',
                     'confirmation_ack','error'
                   )),
  author_user_id  uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  content         text NOT NULL DEFAULT '' CHECK (length(content) <= 8000),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb
                  CHECK (jsonb_typeof(payload) = 'object'),
  run             jsonb NOT NULL DEFAULT '{}'::jsonb
                  CHECK (jsonb_typeof(run) = 'object'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_messages_id_company_uk UNIQUE (id, company_id),
  CONSTRAINT coach_messages_conv_fk FOREIGN KEY (conversation_id, company_id)
    REFERENCES public.coach_conversations (id, company_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coach_messages_conv_time
  ON public.coach_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_coach_messages_company_time
  ON public.coach_messages (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coach_messages_kind
  ON public.coach_messages (conversation_id, kind, created_at);

GRANT SELECT, INSERT ON public.coach_messages TO authenticated;
GRANT ALL           ON public.coach_messages TO service_role;

ALTER TABLE public.coach_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY coach_msg_select
  ON public.coach_messages FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND EXISTS (
      SELECT 1 FROM public.coach_conversations c
       WHERE c.id = coach_messages.conversation_id
         AND c.company_id = coach_messages.company_id
         AND (c.owner_user_id = auth.uid()
              OR public.has_role(auth.uid(), c.company_id, 'admin'))
    )
  );

CREATE POLICY coach_msg_insert
  ON public.coach_messages FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_company_id()
    AND (author_user_id IS NULL OR author_user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.coach_conversations c
       WHERE c.id = coach_messages.conversation_id
         AND c.company_id = coach_messages.company_id
         AND (c.owner_user_id = auth.uid()
              OR public.has_role(auth.uid(), c.company_id, 'admin'))
    )
  );

-- Append-only: no UPDATE, no DELETE policy. Enforced also by trigger below.
CREATE OR REPLACE FUNCTION public.coach_messages_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'coach_messages is append-only' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER tg_coach_msg_append_only_upd
  BEFORE UPDATE ON public.coach_messages
  FOR EACH ROW EXECUTE FUNCTION public.coach_messages_append_only();

CREATE TRIGGER tg_coach_msg_append_only_del
  BEFORE DELETE ON public.coach_messages
  FOR EACH ROW EXECUTE FUNCTION public.coach_messages_append_only();

-- ---------------------------------------------------------------------------
-- 3. coach_rule_proposals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coach_rule_proposals (
  id                  uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id          uuid NOT NULL,
  conversation_id     uuid NOT NULL,
  source_message_id   uuid NOT NULL,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending','edited','discarded','confirmed','failed'
                      )),
  title               text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 120),
  category            public.coach_rule_category NOT NULL,
  rule_type           public.coach_rule_type      NOT NULL,
  -- Phase 2 restriction: model may only produce 'company' or 'channel'.
  scope_kind          public.coach_rule_scope_kind NOT NULL DEFAULT 'company'
                      CHECK (scope_kind IN ('company','channel')),
  scope_ref           jsonb NOT NULL DEFAULT '{}'::jsonb
                      CHECK (jsonb_typeof(scope_ref) = 'object'),
  priority            smallint NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  condition           text NULL CHECK (condition IS NULL OR length(condition) <= 500),
  instruction         text NOT NULL CHECK (length(btrim(instruction)) BETWEEN 3 AND 2000),
  rationale           text NULL CHECK (rationale IS NULL OR length(rationale) <= 1000),
  confidence          numeric(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  risk_level          text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high','critical')),
  ambiguities         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(ambiguities) = 'array'),
  missing_information jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(missing_information) = 'array'),
  warnings            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings) = 'array'),
  normalized_output   jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(normalized_output) = 'object'),
  model_provider      text NOT NULL CHECK (length(model_provider) BETWEEN 1 AND 60),
  model_name          text NOT NULL CHECK (length(model_name)    BETWEEN 1 AND 120),
  prompt_version      text NOT NULL CHECK (length(prompt_version) BETWEEN 1 AND 120),
  edit_count          integer NOT NULL DEFAULT 0 CHECK (edit_count >= 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  confirmed_at        timestamptz NULL,
  discarded_at        timestamptz NULL,
  confirmed_by        uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_rule_id     uuid NULL REFERENCES public.coach_rules(id)         ON DELETE SET NULL,
  created_version_id  uuid NULL REFERENCES public.coach_rule_versions(id) ON DELETE SET NULL,
  CONSTRAINT coach_proposals_id_company_uk UNIQUE (id, company_id),
  CONSTRAINT coach_proposals_conv_fk FOREIGN KEY (conversation_id, company_id)
    REFERENCES public.coach_conversations (id, company_id) ON DELETE CASCADE,
  CONSTRAINT coach_proposals_msg_fk FOREIGN KEY (source_message_id, company_id)
    REFERENCES public.coach_messages (id, company_id) ON DELETE CASCADE,
  CONSTRAINT coach_proposals_confirmed_ok CHECK (
    (status = 'confirmed'
      AND confirmed_at IS NOT NULL
      AND confirmed_by IS NOT NULL
      AND created_rule_id IS NOT NULL
      AND created_version_id IS NOT NULL)
    OR (status <> 'confirmed'
      AND (confirmed_at IS NULL OR TRUE))  -- confirmed_at may still be set only for confirmed status
  )
);

CREATE INDEX IF NOT EXISTS idx_coach_proposals_company_status_time
  ON public.coach_rule_proposals (company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coach_proposals_conv
  ON public.coach_rule_proposals (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_coach_proposals_pending
  ON public.coach_rule_proposals (company_id, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_coach_proposals_created_rule
  ON public.coach_rule_proposals (created_rule_id) WHERE created_rule_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON public.coach_rule_proposals TO authenticated;
GRANT ALL                    ON public.coach_rule_proposals TO service_role;

ALTER TABLE public.coach_rule_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY coach_prop_select
  ON public.coach_rule_proposals FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND EXISTS (
      SELECT 1 FROM public.coach_conversations c
       WHERE c.id = coach_rule_proposals.conversation_id
         AND c.company_id = coach_rule_proposals.company_id
         AND (c.owner_user_id = auth.uid()
              OR public.has_role(auth.uid(), c.company_id, 'admin'))
    )
  );

CREATE POLICY coach_prop_insert
  ON public.coach_rule_proposals FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_company_id()
    AND status IN ('pending','failed')
    AND confirmed_at IS NULL
    AND created_rule_id IS NULL
    AND created_version_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.coach_conversations c
       WHERE c.id = coach_rule_proposals.conversation_id
         AND c.company_id = coach_rule_proposals.company_id
         AND (c.owner_user_id = auth.uid()
              OR public.has_role(auth.uid(), c.company_id, 'admin'))
    )
  );

-- Direct UPDATE (edit / discard) only allowed for pending/edited state and
-- must not touch confirmation columns. Confirmation is done via RPC only.
CREATE POLICY coach_prop_update_edit_discard
  ON public.coach_rule_proposals FOR UPDATE TO authenticated
  USING (
    company_id = public.current_company_id()
    AND status IN ('pending','edited')
    AND EXISTS (
      SELECT 1 FROM public.coach_conversations c
       WHERE c.id = coach_rule_proposals.conversation_id
         AND c.company_id = coach_rule_proposals.company_id
         AND (c.owner_user_id = auth.uid()
              OR public.has_role(auth.uid(), c.company_id, 'admin'))
    )
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND status IN ('edited','discarded')
    AND confirmed_at IS NULL
    AND confirmed_by IS NULL
    AND created_rule_id IS NULL
    AND created_version_id IS NULL
  );

-- No DELETE policy.

CREATE TRIGGER tg_coach_prop_updated
  BEFORE UPDATE ON public.coach_rule_proposals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER tg_coach_prop_no_tenant_change
  BEFORE UPDATE ON public.coach_rule_proposals
  FOR EACH ROW EXECUTE FUNCTION public.coach_prevent_company_change();

-- ---------------------------------------------------------------------------
-- 4. RPC: confirm_coach_rule_proposal — atomic
--     * admin only
--     * tenant-safe
--     * idempotent (re-calling on confirmed returns the same rule/version)
--     * critical categories require _critical_confirmed=true
--     * scope_kind='agent' is refused in Phase 2
--     * overrides allowed for a fixed whitelist of fields
--     * creates rule + draft version + updates the proposal in one transaction
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_coach_rule_proposal(
  _proposal_id uuid,
  _overrides   jsonb DEFAULT '{}'::jsonb,
  _critical_confirmed boolean DEFAULT false
) RETURNS TABLE(rule_id uuid, version_id uuid, was_already_confirmed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company   uuid := public.current_company_id();
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
  v_new_status text;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'coach_no_company' USING ERRCODE = '42501';
  END IF;
  PERFORM public.coach_assert_admin(v_company);

  IF _overrides IS NULL OR jsonb_typeof(_overrides) <> 'object' THEN
    _overrides := '{}'::jsonb;
  END IF;

  -- Lock the proposal row.
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

  -- Idempotency: if already confirmed, return the existing rule/version.
  IF v_row.status = 'confirmed' THEN
    RETURN QUERY SELECT v_row.created_rule_id, v_row.created_version_id, true;
    RETURN;
  END IF;

  IF v_row.status IN ('discarded','failed') THEN
    RAISE EXCEPTION 'coach_proposal_not_confirmable' USING ERRCODE = '22023';
  END IF;

  -- Apply whitelisted overrides.
  v_title       := COALESCE(NULLIF(btrim(_overrides->>'title'),''), v_row.title);
  v_instruction := COALESCE(NULLIF(btrim(_overrides->>'instruction'),''), v_row.instruction);
  v_priority    := COALESCE(NULLIF(_overrides->>'priority','')::smallint, v_row.priority);
  v_category    := v_row.category;  -- category and rule_type are NOT overridable
  v_rule_type   := v_row.rule_type;
  v_scope_kind  := COALESCE(
                     NULLIF(_overrides->>'scope_kind','')::public.coach_rule_scope_kind,
                     v_row.scope_kind);
  v_scope_ref   := COALESCE(_overrides->'scope_ref', v_row.scope_ref);

  -- Phase 2: reject scope 'agent' end-to-end.
  IF v_scope_kind = 'agent' THEN
    RAISE EXCEPTION 'coach_scope_agent_not_supported_in_phase_2' USING ERRCODE = '22023';
  END IF;

  -- Range guards on the overridden values.
  IF v_priority IS NULL OR v_priority < 0 OR v_priority > 100 THEN
    RAISE EXCEPTION 'coach_invalid_priority' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(v_title)) < 3 OR length(btrim(v_title)) > 120 THEN
    RAISE EXCEPTION 'coach_invalid_title' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(v_instruction)) < 3 OR length(btrim(v_instruction)) > 2000 THEN
    RAISE EXCEPTION 'coach_invalid_instruction' USING ERRCODE = '22023';
  END IF;

  -- Critical category safeguard.
  IF public.coach_is_critical_category(v_category) AND _critical_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'coach_critical_confirmation_required' USING ERRCODE = '22023';
  END IF;

  -- content sent to Phase 1 = the operational instruction.
  v_content := v_instruction;

  -- Create the draft rule + draft version through the Phase 1 RPC.
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

  -- Audit note into coach_messages (append-only, tenant-scoped).
  INSERT INTO public.coach_messages
    (company_id, conversation_id, kind, author_user_id, content, payload, run)
  VALUES
    (v_company,
     v_row.conversation_id,
     'confirmation_ack',
     auth.uid(),
     '',
     jsonb_build_object(
       'proposal_id',       _proposal_id,
       'rule_id',           v_created.rule_id,
       'version_id',        v_created.version_id,
       'critical_confirmed', COALESCE(_critical_confirmed,false)
     ),
     '{}'::jsonb);

  RETURN QUERY SELECT v_created.rule_id, v_created.version_id, false;
END;
$$;

-- Tighten ACLs on the new RPC.
REVOKE ALL ON FUNCTION public.confirm_coach_rule_proposal(uuid, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_coach_rule_proposal(uuid, jsonb, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_coach_rule_proposal(uuid, jsonb, boolean) TO authenticated;

-- Restrict the append-only helper.
REVOKE ALL ON FUNCTION public.coach_messages_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coach_messages_append_only() FROM anon;
REVOKE ALL ON FUNCTION public.coach_messages_append_only() FROM authenticated;

-- ---------------------------------------------------------------------------
-- 5. Documentation
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.coach_conversations IS
  'Coach V2 Phase 2 — conversation threads between a company member and the Coach Interpreter.';
COMMENT ON TABLE public.coach_messages IS
  'Coach V2 Phase 2 — append-only messages inside a Coach conversation. Sanitized run metadata only.';
COMMENT ON TABLE public.coach_rule_proposals IS
  'Coach V2 Phase 2 — LLM-extracted rule proposals. Confirm via confirm_coach_rule_proposal RPC only.';
COMMENT ON FUNCTION public.confirm_coach_rule_proposal(uuid, jsonb, boolean) IS
  'Atomic admin-only confirmation. Idempotent. Refuses scope=agent in Phase 2. Creates draft rule + draft version via create_coach_rule_draft.';
