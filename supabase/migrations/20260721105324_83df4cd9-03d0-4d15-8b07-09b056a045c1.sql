
-- =====================================================================
-- COACH V2 — PHASE 1 FOUNDATION (dark & isolated)
-- =====================================================================

-- ---------- ENUMS ----------
CREATE TYPE public.coach_rule_category AS ENUM (
  'identity','tone','qualification','sales','pricing','negotiation',
  'discounts','payments','followup','human_handoff','prohibitions',
  'safety','after_sales','other'
);

CREATE TYPE public.coach_rule_type AS ENUM (
  'instruction','prohibition','mandatory_action','mandatory_question',
  'handoff','standard_reply','preference'
);

CREATE TYPE public.coach_rule_scope_kind AS ENUM ('company','agent','channel');

CREATE TYPE public.coach_rule_status AS ENUM (
  'draft','active','paused','archived','replaced'
);

CREATE TYPE public.coach_rule_version_status AS ENUM (
  'draft','pending_approval','approved','rejected','archived'
);

CREATE TYPE public.coach_rule_event_type AS ENUM (
  'rule_created','version_created','version_submitted','version_approved',
  'version_self_approved','version_rejected','version_activated',
  'rule_paused','rule_resumed','rule_archived','rule_replaced',
  'conflict_detected','conflict_resolved'
);

-- ---------- HELPER: scope_ref validator ----------
CREATE OR REPLACE FUNCTION public.coach_validate_scope_ref(
  _kind public.coach_rule_scope_kind,
  _ref jsonb
) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF _ref IS NULL OR jsonb_typeof(_ref) <> 'object' THEN
    RETURN false;
  END IF;
  IF _kind = 'company' THEN
    RETURN _ref = '{}'::jsonb;
  ELSIF _kind = 'agent' THEN
    RETURN (_ref ? 'agent_id')
       AND jsonb_typeof(_ref->'agent_id') = 'string'
       AND length(_ref->>'agent_id') BETWEEN 1 AND 128;
  ELSIF _kind = 'channel' THEN
    RETURN (_ref ? 'channel')
       AND jsonb_typeof(_ref->'channel') = 'string'
       AND (_ref->>'channel') IN ('whatsapp','instagram','facebook','web','other');
  END IF;
  RETURN false;
END;
$$;

-- =====================================================================
-- 1) COACH_RULES (stable identity)
-- =====================================================================
CREATE TABLE public.coach_rules (
  id                   UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id           UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  category             public.coach_rule_category NOT NULL,
  title                TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  priority             SMALLINT NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  status               public.coach_rule_status NOT NULL DEFAULT 'draft',
  scope_kind           public.coach_rule_scope_kind NOT NULL DEFAULT 'company',
  scope_ref            JSONB NOT NULL DEFAULT '{}'::jsonb,
  active_version_id    UUID, -- FK added later (cyclic)
  valid_from           TIMESTAMPTZ,
  valid_until          TIMESTAMPTZ,
  replaced_by_rule_id  UUID REFERENCES public.coach_rules(id) ON DELETE SET NULL,
  created_by           UUID NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at         TIMESTAMPTZ,
  paused_at            TIMESTAMPTZ,
  archived_at          TIMESTAMPTZ,
  replaced_at          TIMESTAMPTZ,
  CONSTRAINT coach_rules_scope_ref_valid
    CHECK (public.coach_validate_scope_ref(scope_kind, scope_ref)),
  CONSTRAINT coach_rules_validity_window
    CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from)
);

GRANT SELECT ON public.coach_rules TO authenticated;
GRANT ALL ON public.coach_rules TO service_role;
ALTER TABLE public.coach_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coach_rules_read_same_company"
  ON public.coach_rules FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

CREATE INDEX idx_coach_rules_company ON public.coach_rules(company_id);
CREATE INDEX idx_coach_rules_status ON public.coach_rules(company_id, status);
CREATE INDEX idx_coach_rules_category ON public.coach_rules(company_id, category);

CREATE TRIGGER trg_coach_rules_updated
  BEFORE UPDATE ON public.coach_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 2) COACH_RULE_VERSIONS (immutable once approved/active/archived)
-- =====================================================================
CREATE TABLE public.coach_rule_versions (
  id                    UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_id               UUID NOT NULL REFERENCES public.coach_rules(id) ON DELETE CASCADE,
  company_id            UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  version_number        INTEGER NOT NULL,
  rule_type             public.coach_rule_type NOT NULL,
  category              public.coach_rule_category NOT NULL,
  priority              SMALLINT NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  scope_kind            public.coach_rule_scope_kind NOT NULL,
  scope_ref             JSONB NOT NULL DEFAULT '{}'::jsonb,
  title                 TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  content               TEXT NOT NULL CHECK (length(btrim(content)) BETWEEN 3 AND 8000),
  content_hash          TEXT NOT NULL,
  status                public.coach_rule_version_status NOT NULL DEFAULT 'draft',
  base_version_id       UUID REFERENCES public.coach_rule_versions(id) ON DELETE SET NULL,
  critical_confirmed    BOOLEAN NOT NULL DEFAULT false,
  rejection_reason      TEXT,
  created_by            UUID NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at          TIMESTAMPTZ,
  submitted_by          UUID,
  approved_at           TIMESTAMPTZ,
  approved_by           UUID,
  is_self_approval      BOOLEAN NOT NULL DEFAULT false,
  rejected_at           TIMESTAMPTZ,
  rejected_by           UUID,
  activated_at          TIMESTAMPTZ,
  archived_at           TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coach_rule_versions_unique_number UNIQUE (rule_id, version_number),
  CONSTRAINT coach_rule_versions_scope_ref_valid
    CHECK (public.coach_validate_scope_ref(scope_kind, scope_ref))
);

GRANT SELECT ON public.coach_rule_versions TO authenticated;
GRANT ALL ON public.coach_rule_versions TO service_role;
ALTER TABLE public.coach_rule_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coach_rule_versions_read_same_company"
  ON public.coach_rule_versions FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

CREATE INDEX idx_coach_rule_versions_rule ON public.coach_rule_versions(rule_id, version_number DESC);
CREATE INDEX idx_coach_rule_versions_company_status
  ON public.coach_rule_versions(company_id, status);

CREATE TRIGGER trg_coach_rule_versions_updated
  BEFORE UPDATE ON public.coach_rule_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Immutability guard: once approved/active/archived/rejected, block mutations
-- to content-defining columns. Only the status/lifecycle transitions handled
-- inside RPCs are permitted.
CREATE OR REPLACE FUNCTION public.coach_rule_versions_immutable_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IN ('approved','rejected','archived')
     OR (OLD.status = 'pending_approval' AND NEW.status = OLD.status) THEN
    -- Content-defining fields are frozen once out of 'draft'.
    IF OLD.status <> 'draft' THEN
      IF NEW.content IS DISTINCT FROM OLD.content
         OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
         OR NEW.title IS DISTINCT FROM OLD.title
         OR NEW.rule_type IS DISTINCT FROM OLD.rule_type
         OR NEW.category IS DISTINCT FROM OLD.category
         OR NEW.priority IS DISTINCT FROM OLD.priority
         OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
         OR NEW.scope_ref IS DISTINCT FROM OLD.scope_ref THEN
        RAISE EXCEPTION 'coach_rule_version_immutable';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_coach_rule_versions_immutable
  BEFORE UPDATE ON public.coach_rule_versions
  FOR EACH ROW EXECUTE FUNCTION public.coach_rule_versions_immutable_guard();

-- Now add the cyclic FK from coach_rules.active_version_id
ALTER TABLE public.coach_rules
  ADD CONSTRAINT coach_rules_active_version_fk
  FOREIGN KEY (active_version_id) REFERENCES public.coach_rule_versions(id) ON DELETE SET NULL;

-- =====================================================================
-- 3) COACH_RULE_CONFLICTS (reserved for future detector)
-- =====================================================================
CREATE TABLE public.coach_rule_conflicts (
  id                     UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id             UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  rule_id                UUID NOT NULL REFERENCES public.coach_rules(id) ON DELETE CASCADE,
  version_id             UUID NOT NULL REFERENCES public.coach_rule_versions(id) ON DELETE CASCADE,
  conflicting_version_id UUID REFERENCES public.coach_rule_versions(id) ON DELETE SET NULL,
  conflict_type          TEXT NOT NULL CHECK (length(conflict_type) BETWEEN 2 AND 60),
  details                JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                 TEXT NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open','resolved','ignored')),
  detected_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at            TIMESTAMPTZ,
  resolved_by            UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.coach_rule_conflicts TO authenticated;
GRANT ALL ON public.coach_rule_conflicts TO service_role;
ALTER TABLE public.coach_rule_conflicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coach_rule_conflicts_read_same_company"
  ON public.coach_rule_conflicts FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

CREATE INDEX idx_coach_rule_conflicts_rule ON public.coach_rule_conflicts(rule_id);
CREATE INDEX idx_coach_rule_conflicts_company_status
  ON public.coach_rule_conflicts(company_id, status);

CREATE TRIGGER trg_coach_rule_conflicts_updated
  BEFORE UPDATE ON public.coach_rule_conflicts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 4) COACH_RULE_EVENTS (append-only audit)
-- =====================================================================
CREATE TABLE public.coach_rule_events (
  id                UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  rule_id           UUID NOT NULL REFERENCES public.coach_rules(id) ON DELETE CASCADE,
  version_id        UUID REFERENCES public.coach_rule_versions(id) ON DELETE SET NULL,
  event_type        public.coach_rule_event_type NOT NULL,
  actor_user_id     UUID,
  is_self_approval  BOOLEAN NOT NULL DEFAULT false,
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.coach_rule_events TO authenticated;
GRANT ALL ON public.coach_rule_events TO service_role;
ALTER TABLE public.coach_rule_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coach_rule_events_read_same_company"
  ON public.coach_rule_events FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

CREATE INDEX idx_coach_rule_events_rule ON public.coach_rule_events(rule_id, created_at DESC);
CREATE INDEX idx_coach_rule_events_company ON public.coach_rule_events(company_id, created_at DESC);

-- Append-only guard
CREATE OR REPLACE FUNCTION public.coach_rule_events_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'coach_rule_events is append-only';
END;
$$;

CREATE TRIGGER trg_coach_rule_events_no_update
  BEFORE UPDATE ON public.coach_rule_events
  FOR EACH ROW EXECUTE FUNCTION public.coach_rule_events_append_only();

CREATE TRIGGER trg_coach_rule_events_no_delete
  BEFORE DELETE ON public.coach_rule_events
  FOR EACH ROW EXECUTE FUNCTION public.coach_rule_events_append_only();

-- =====================================================================
-- HELPER FUNCTIONS
-- =====================================================================
CREATE OR REPLACE FUNCTION public.coach_is_critical_category(_cat public.coach_rule_category)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT _cat IN ('safety','pricing','discounts','payments','prohibitions','human_handoff');
$$;

CREATE OR REPLACE FUNCTION public.coach_content_hash(
  _category public.coach_rule_category,
  _rule_type public.coach_rule_type,
  _priority smallint,
  _scope_kind public.coach_rule_scope_kind,
  _scope_ref jsonb,
  _title text,
  _content text
) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT encode(
    extensions.digest(
      concat_ws('|',
        _category::text, _rule_type::text, _priority::text,
        _scope_kind::text, _scope_ref::text, btrim(_title), btrim(_content)
      ),
      'sha256'
    ),
    'hex'
  );
$$;

-- Guarded admin assertion used by RPCs
CREATE OR REPLACE FUNCTION public.coach_assert_admin(_company_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'coach_unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(auth.uid(), _company_id, 'admin') THEN
    RAISE EXCEPTION 'coach_forbidden_admin_only' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- =====================================================================
-- RPC: create_coach_rule_draft
-- Creates a coach_rule (status=draft) AND its version 1 (status=draft)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.create_coach_rule_draft(
  _category public.coach_rule_category,
  _rule_type public.coach_rule_type,
  _title text,
  _content text,
  _priority smallint DEFAULT 50,
  _scope_kind public.coach_rule_scope_kind DEFAULT 'company',
  _scope_ref jsonb DEFAULT '{}'::jsonb,
  _valid_from timestamptz DEFAULT NULL,
  _valid_until timestamptz DEFAULT NULL
) RETURNS TABLE(rule_id uuid, version_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_rule uuid;
  v_version uuid;
  v_hash text;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'coach_no_company' USING ERRCODE = '42501'; END IF;
  PERFORM public.coach_assert_admin(v_company);
  IF NOT public.coach_validate_scope_ref(_scope_kind, COALESCE(_scope_ref, '{}'::jsonb)) THEN
    RAISE EXCEPTION 'coach_invalid_scope_ref' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.coach_rules
    (company_id, category, title, priority, status, scope_kind, scope_ref,
     valid_from, valid_until, created_by)
  VALUES
    (v_company, _category, _title, _priority, 'draft', _scope_kind,
     COALESCE(_scope_ref,'{}'::jsonb), _valid_from, _valid_until, auth.uid())
  RETURNING id INTO v_rule;

  v_hash := public.coach_content_hash(_category, _rule_type, _priority,
                                      _scope_kind, COALESCE(_scope_ref,'{}'::jsonb),
                                      _title, _content);

  INSERT INTO public.coach_rule_versions
    (rule_id, company_id, version_number, rule_type, category, priority,
     scope_kind, scope_ref, title, content, content_hash, status, created_by)
  VALUES
    (v_rule, v_company, 1, _rule_type, _category, _priority,
     _scope_kind, COALESCE(_scope_ref,'{}'::jsonb), _title, _content, v_hash,
     'draft', auth.uid())
  RETURNING id INTO v_version;

  INSERT INTO public.coach_rule_events (company_id, rule_id, version_id, event_type, actor_user_id, details)
  VALUES (v_company, v_rule, v_version, 'rule_created', auth.uid(),
          jsonb_build_object('category',_category,'rule_type',_rule_type,'priority',_priority));

  RETURN QUERY SELECT v_rule, v_version;
END;
$$;

-- =====================================================================
-- RPC: create_coach_rule_version
-- Creates a new draft version for an existing rule (never mutates old ones)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.create_coach_rule_version(
  _rule_id uuid,
  _rule_type public.coach_rule_type,
  _title text,
  _content text,
  _priority smallint DEFAULT 50,
  _scope_kind public.coach_rule_scope_kind DEFAULT NULL,
  _scope_ref jsonb DEFAULT NULL,
  _base_version_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_rule public.coach_rules;
  v_next_number integer;
  v_version uuid;
  v_hash text;
  v_scope_kind public.coach_rule_scope_kind;
  v_scope_ref jsonb;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'coach_no_company' USING ERRCODE = '42501'; END IF;
  PERFORM public.coach_assert_admin(v_company);

  SELECT * INTO v_rule FROM public.coach_rules WHERE id = _rule_id FOR UPDATE;
  IF NOT FOUND OR v_rule.company_id <> v_company THEN
    RAISE EXCEPTION 'coach_rule_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_rule.status IN ('archived','replaced') THEN
    RAISE EXCEPTION 'coach_rule_locked' USING ERRCODE = '22023';
  END IF;

  v_scope_kind := COALESCE(_scope_kind, v_rule.scope_kind);
  v_scope_ref  := COALESCE(_scope_ref, v_rule.scope_ref);
  IF NOT public.coach_validate_scope_ref(v_scope_kind, v_scope_ref) THEN
    RAISE EXCEPTION 'coach_invalid_scope_ref' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(MAX(version_number),0) + 1 INTO v_next_number
    FROM public.coach_rule_versions WHERE rule_id = _rule_id;

  v_hash := public.coach_content_hash(v_rule.category, _rule_type, _priority,
                                      v_scope_kind, v_scope_ref, _title, _content);

  INSERT INTO public.coach_rule_versions
    (rule_id, company_id, version_number, rule_type, category, priority,
     scope_kind, scope_ref, title, content, content_hash, status,
     base_version_id, created_by)
  VALUES
    (_rule_id, v_company, v_next_number, _rule_type, v_rule.category, _priority,
     v_scope_kind, v_scope_ref, _title, _content, v_hash, 'draft',
     _base_version_id, auth.uid())
  RETURNING id INTO v_version;

  INSERT INTO public.coach_rule_events (company_id, rule_id, version_id, event_type, actor_user_id, details)
  VALUES (v_company, _rule_id, v_version, 'version_created', auth.uid(),
          jsonb_build_object('version_number', v_next_number, 'base_version_id', _base_version_id));

  RETURN v_version;
END;
$$;

-- =====================================================================
-- RPC: submit_coach_rule_version (draft -> pending_approval)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.submit_coach_rule_version(_version_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_row public.coach_rule_versions;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'coach_no_company' USING ERRCODE = '42501'; END IF;
  PERFORM public.coach_assert_admin(v_company);

  SELECT * INTO v_row FROM public.coach_rule_versions WHERE id = _version_id FOR UPDATE;
  IF NOT FOUND OR v_row.company_id <> v_company THEN
    RAISE EXCEPTION 'coach_version_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status <> 'draft' THEN
    RAISE EXCEPTION 'coach_version_not_draft' USING ERRCODE = '22023';
  END IF;

  UPDATE public.coach_rule_versions
     SET status = 'pending_approval', submitted_at = now(), submitted_by = auth.uid()
   WHERE id = _version_id;

  INSERT INTO public.coach_rule_events (company_id, rule_id, version_id, event_type, actor_user_id)
  VALUES (v_company, v_row.rule_id, _version_id, 'version_submitted', auth.uid());
END;
$$;

-- =====================================================================
-- RPC: approve_coach_rule_version
-- Admin approves. Self-approval is allowed but flagged.
-- Critical categories require _critical_confirmed = true.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.approve_coach_rule_version(
  _version_id uuid,
  _critical_confirmed boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_row public.coach_rule_versions;
  v_is_self boolean;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'coach_no_company' USING ERRCODE = '42501'; END IF;
  PERFORM public.coach_assert_admin(v_company);

  SELECT * INTO v_row FROM public.coach_rule_versions WHERE id = _version_id FOR UPDATE;
  IF NOT FOUND OR v_row.company_id <> v_company THEN
    RAISE EXCEPTION 'coach_version_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'coach_version_not_pending' USING ERRCODE = '22023';
  END IF;

  IF public.coach_is_critical_category(v_row.category) AND _critical_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'coach_critical_confirmation_required' USING ERRCODE = '22023';
  END IF;

  v_is_self := (v_row.created_by = auth.uid());

  UPDATE public.coach_rule_versions
     SET status = 'approved',
         approved_at = now(),
         approved_by = auth.uid(),
         is_self_approval = v_is_self,
         critical_confirmed = COALESCE(_critical_confirmed, false)
   WHERE id = _version_id;

  INSERT INTO public.coach_rule_events (company_id, rule_id, version_id, event_type, actor_user_id, is_self_approval, details)
  VALUES (v_company, v_row.rule_id, _version_id,
          CASE WHEN v_is_self THEN 'version_self_approved'::public.coach_rule_event_type
               ELSE 'version_approved'::public.coach_rule_event_type END,
          auth.uid(), v_is_self,
          jsonb_build_object('critical_confirmed', COALESCE(_critical_confirmed,false)));
END;
$$;

-- =====================================================================
-- RPC: reject_coach_rule_version
-- =====================================================================
CREATE OR REPLACE FUNCTION public.reject_coach_rule_version(
  _version_id uuid,
  _reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_row public.coach_rule_versions;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'coach_no_company' USING ERRCODE = '42501'; END IF;
  PERFORM public.coach_assert_admin(v_company);
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN
    RAISE EXCEPTION 'coach_reject_reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.coach_rule_versions WHERE id = _version_id FOR UPDATE;
  IF NOT FOUND OR v_row.company_id <> v_company THEN
    RAISE EXCEPTION 'coach_version_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'coach_version_not_pending' USING ERRCODE = '22023';
  END IF;

  UPDATE public.coach_rule_versions
     SET status = 'rejected', rejected_at = now(), rejected_by = auth.uid(), rejection_reason = _reason
   WHERE id = _version_id;

  INSERT INTO public.coach_rule_events (company_id, rule_id, version_id, event_type, actor_user_id, details)
  VALUES (v_company, v_row.rule_id, _version_id, 'version_rejected', auth.uid(),
          jsonb_build_object('reason', _reason));
END;
$$;

-- =====================================================================
-- RPC: activate_coach_rule_version (approved -> active on rule, archives prev)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.activate_coach_rule_version(_version_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_row public.coach_rule_versions;
  v_prev_active uuid;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'coach_no_company' USING ERRCODE = '42501'; END IF;
  PERFORM public.coach_assert_admin(v_company);

  SELECT * INTO v_row FROM public.coach_rule_versions WHERE id = _version_id FOR UPDATE;
  IF NOT FOUND OR v_row.company_id <> v_company THEN
    RAISE EXCEPTION 'coach_version_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'coach_version_not_approved' USING ERRCODE = '22023';
  END IF;

  SELECT active_version_id INTO v_prev_active FROM public.coach_rules WHERE id = v_row.rule_id FOR UPDATE;

  -- Archive previously active version (if any & different)
  IF v_prev_active IS NOT NULL AND v_prev_active <> _version_id THEN
    UPDATE public.coach_rule_versions
       SET status = 'archived', archived_at = now()
     WHERE id = v_prev_active;
  END IF;

  UPDATE public.coach_rule_versions
     SET activated_at = now()
   WHERE id = _version_id;

  UPDATE public.coach_rules
     SET active_version_id = _version_id,
         status = 'active',
         activated_at = COALESCE(activated_at, now()),
         paused_at = NULL
   WHERE id = v_row.rule_id;

  INSERT INTO public.coach_rule_events (company_id, rule_id, version_id, event_type, actor_user_id, details)
  VALUES (v_company, v_row.rule_id, _version_id, 'version_activated', auth.uid(),
          jsonb_build_object('previous_active_version_id', v_prev_active));
END;
$$;

-- =====================================================================
-- RPC: pause_coach_rule
-- =====================================================================
CREATE OR REPLACE FUNCTION public.pause_coach_rule(_rule_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_rule public.coach_rules;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'coach_no_company' USING ERRCODE = '42501'; END IF;
  PERFORM public.coach_assert_admin(v_company);

  SELECT * INTO v_rule FROM public.coach_rules WHERE id = _rule_id FOR UPDATE;
  IF NOT FOUND OR v_rule.company_id <> v_company THEN
    RAISE EXCEPTION 'coach_rule_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_rule.status = 'active' THEN
    UPDATE public.coach_rules SET status = 'paused', paused_at = now() WHERE id = _rule_id;
    INSERT INTO public.coach_rule_events (company_id, rule_id, event_type, actor_user_id)
    VALUES (v_company, _rule_id, 'rule_paused', auth.uid());
  ELSIF v_rule.status = 'paused' THEN
    UPDATE public.coach_rules SET status = 'active', paused_at = NULL WHERE id = _rule_id;
    INSERT INTO public.coach_rule_events (company_id, rule_id, event_type, actor_user_id)
    VALUES (v_company, _rule_id, 'rule_resumed', auth.uid());
  ELSE
    RAISE EXCEPTION 'coach_rule_not_toggleable' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- =====================================================================
-- RPC: archive_coach_rule
-- =====================================================================
CREATE OR REPLACE FUNCTION public.archive_coach_rule(_rule_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_rule public.coach_rules;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'coach_no_company' USING ERRCODE = '42501'; END IF;
  PERFORM public.coach_assert_admin(v_company);

  SELECT * INTO v_rule FROM public.coach_rules WHERE id = _rule_id FOR UPDATE;
  IF NOT FOUND OR v_rule.company_id <> v_company THEN
    RAISE EXCEPTION 'coach_rule_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_rule.status IN ('archived','replaced') THEN
    RETURN;
  END IF;

  UPDATE public.coach_rules
     SET status = 'archived', archived_at = now(), active_version_id = NULL
   WHERE id = _rule_id;

  -- Archive any active version
  IF v_rule.active_version_id IS NOT NULL THEN
    UPDATE public.coach_rule_versions
       SET status = 'archived', archived_at = now()
     WHERE id = v_rule.active_version_id AND status <> 'archived';
  END IF;

  INSERT INTO public.coach_rule_events (company_id, rule_id, event_type, actor_user_id)
  VALUES (v_company, _rule_id, 'rule_archived', auth.uid());
END;
$$;

-- =====================================================================
-- RPC: replace_coach_rule
-- Marks _old_rule_id as replaced by _new_rule_id (both must belong to caller)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.replace_coach_rule(
  _old_rule_id uuid,
  _new_rule_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_old public.coach_rules;
  v_new public.coach_rules;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'coach_no_company' USING ERRCODE = '42501'; END IF;
  PERFORM public.coach_assert_admin(v_company);
  IF _old_rule_id = _new_rule_id THEN
    RAISE EXCEPTION 'coach_replace_same_rule' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM public.coach_rules WHERE id = _old_rule_id FOR UPDATE;
  SELECT * INTO v_new FROM public.coach_rules WHERE id = _new_rule_id FOR UPDATE;
  IF v_old.company_id <> v_company OR v_new.company_id <> v_company THEN
    RAISE EXCEPTION 'coach_rule_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_old.status IN ('archived','replaced') THEN
    RAISE EXCEPTION 'coach_rule_locked' USING ERRCODE = '22023';
  END IF;

  UPDATE public.coach_rules
     SET status = 'replaced', replaced_at = now(), replaced_by_rule_id = _new_rule_id,
         active_version_id = NULL
   WHERE id = _old_rule_id;

  IF v_old.active_version_id IS NOT NULL THEN
    UPDATE public.coach_rule_versions
       SET status = 'archived', archived_at = now()
     WHERE id = v_old.active_version_id AND status <> 'archived';
  END IF;

  INSERT INTO public.coach_rule_events (company_id, rule_id, event_type, actor_user_id, details)
  VALUES (v_company, _old_rule_id, 'rule_replaced', auth.uid(),
          jsonb_build_object('replaced_by_rule_id', _new_rule_id));
END;
$$;

-- Grant execute on RPCs to authenticated (admin check happens inside)
GRANT EXECUTE ON FUNCTION public.create_coach_rule_draft(
  public.coach_rule_category, public.coach_rule_type, text, text, smallint,
  public.coach_rule_scope_kind, jsonb, timestamptz, timestamptz
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_coach_rule_version(
  uuid, public.coach_rule_type, text, text, smallint,
  public.coach_rule_scope_kind, jsonb, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_coach_rule_version(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_coach_rule_version(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_coach_rule_version(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_coach_rule_version(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_coach_rule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_coach_rule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_coach_rule(uuid, uuid) TO authenticated;
