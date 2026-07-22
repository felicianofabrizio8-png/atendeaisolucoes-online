
-- ============================================================================
-- Coach Evolutivo — Aprendizado Conversacional
-- ============================================================================

-- 1. coach_learnings
CREATE TABLE public.coach_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  category text NOT NULL,
  product_ref text,
  title text NOT NULL,
  description text NOT NULL,
  rule_structured text NOT NULL,
  positive_example text,
  negative_example text,
  priority smallint NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  confidence numeric NOT NULL DEFAULT 0.7 CHECK (confidence BETWEEN 0 AND 1),
  usage_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  taught_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_conversation_id uuid REFERENCES public.coach_conversations(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX idx_coach_learnings_company ON public.coach_learnings(company_id);
CREATE INDEX idx_coach_learnings_company_status_priority
  ON public.coach_learnings(company_id, status, priority DESC);
CREATE INDEX idx_coach_learnings_product ON public.coach_learnings(company_id, product_ref)
  WHERE product_ref IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_learnings TO authenticated;
GRANT ALL ON public.coach_learnings TO service_role;

ALTER TABLE public.coach_learnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coach_learnings_select_own_company"
  ON public.coach_learnings FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "coach_learnings_insert_own_company"
  ON public.coach_learnings FOR INSERT
  TO authenticated
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "coach_learnings_update_own_company"
  ON public.coach_learnings FOR UPDATE
  TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "coach_learnings_delete_admin_only"
  ON public.coach_learnings FOR DELETE
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), company_id, 'admin')
  );

-- 2. coach_learning_versions (histórico imutável)
CREATE TABLE public.coach_learning_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_id uuid NOT NULL REFERENCES public.coach_learnings(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  version integer NOT NULL,
  category text NOT NULL,
  product_ref text,
  title text NOT NULL,
  description text NOT NULL,
  rule_structured text NOT NULL,
  positive_example text,
  negative_example text,
  priority smallint NOT NULL,
  status text NOT NULL,
  confidence numeric NOT NULL,
  edited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (learning_id, version)
);

CREATE INDEX idx_coach_learning_versions_learning
  ON public.coach_learning_versions(learning_id, version DESC);

GRANT SELECT, INSERT ON public.coach_learning_versions TO authenticated;
GRANT ALL ON public.coach_learning_versions TO service_role;

ALTER TABLE public.coach_learning_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coach_learning_versions_select_own_company"
  ON public.coach_learning_versions FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

-- Versions são append-only via triggers; sem policy de UPDATE/DELETE.
CREATE OR REPLACE FUNCTION public.coach_learning_versions_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'coach_learning_versions is append-only' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER coach_learning_versions_no_update
  BEFORE UPDATE OR DELETE ON public.coach_learning_versions
  FOR EACH ROW EXECUTE FUNCTION public.coach_learning_versions_append_only();

-- 3. updated_at trigger
CREATE TRIGGER set_coach_learnings_updated_at
  BEFORE UPDATE ON public.coach_learnings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. RPCs

-- create_coach_learning
CREATE OR REPLACE FUNCTION public.create_coach_learning(
  _category text,
  _title text,
  _description text,
  _rule_structured text,
  _product_ref text DEFAULT NULL,
  _positive_example text DEFAULT NULL,
  _negative_example text DEFAULT NULL,
  _priority smallint DEFAULT 50,
  _confidence numeric DEFAULT 0.7,
  _source_conversation_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  INSERT INTO public.coach_learnings (
    company_id, category, product_ref, title, description, rule_structured,
    positive_example, negative_example, priority, confidence,
    taught_by, source_conversation_id, version, status
  )
  VALUES (
    v_company, _category, _product_ref, _title, _description, _rule_structured,
    _positive_example, _negative_example,
    GREATEST(0, LEAST(100, COALESCE(_priority, 50))),
    GREATEST(0, LEAST(1, COALESCE(_confidence, 0.7))),
    auth.uid(), _source_conversation_id, 1, 'active'
  )
  RETURNING id INTO v_id;

  INSERT INTO public.coach_learning_versions (
    learning_id, company_id, version, category, product_ref, title, description,
    rule_structured, positive_example, negative_example, priority, status,
    confidence, edited_by
  )
  VALUES (
    v_id, v_company, 1, _category, _product_ref, _title, _description,
    _rule_structured, _positive_example, _negative_example,
    GREATEST(0, LEAST(100, COALESCE(_priority, 50))), 'active',
    GREATEST(0, LEAST(1, COALESCE(_confidence, 0.7))), auth.uid()
  );

  RETURN v_id;
END;
$$;

-- update_coach_learning
CREATE OR REPLACE FUNCTION public.update_coach_learning(
  _learning_id uuid,
  _title text,
  _description text,
  _rule_structured text,
  _category text,
  _product_ref text DEFAULT NULL,
  _positive_example text DEFAULT NULL,
  _negative_example text DEFAULT NULL,
  _priority smallint DEFAULT NULL,
  _status text DEFAULT NULL,
  _confidence numeric DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_row public.coach_learnings;
  v_new_version integer;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'coach_learning_no_company' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.coach_learnings
    WHERE id = _learning_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coach_learning_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.company_id <> v_company THEN
    RAISE EXCEPTION 'coach_learning_cross_tenant' USING ERRCODE = '42501';
  END IF;

  v_new_version := v_row.version + 1;

  UPDATE public.coach_learnings
     SET title = _title,
         description = _description,
         rule_structured = _rule_structured,
         category = _category,
         product_ref = _product_ref,
         positive_example = _positive_example,
         negative_example = _negative_example,
         priority = GREATEST(0, LEAST(100, COALESCE(_priority, v_row.priority))),
         status = COALESCE(_status, v_row.status),
         confidence = GREATEST(0, LEAST(1, COALESCE(_confidence, v_row.confidence))),
         version = v_new_version,
         updated_at = now()
   WHERE id = _learning_id;

  INSERT INTO public.coach_learning_versions (
    learning_id, company_id, version, category, product_ref, title, description,
    rule_structured, positive_example, negative_example, priority, status,
    confidence, edited_by
  )
  VALUES (
    _learning_id, v_company, v_new_version, _category, _product_ref, _title, _description,
    _rule_structured, _positive_example, _negative_example,
    GREATEST(0, LEAST(100, COALESCE(_priority, v_row.priority))),
    COALESCE(_status, v_row.status),
    GREATEST(0, LEAST(1, COALESCE(_confidence, v_row.confidence))),
    auth.uid()
  );

  RETURN v_new_version;
END;
$$;

-- archive_coach_learning (admin-only)
CREATE OR REPLACE FUNCTION public.archive_coach_learning(_learning_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_row public.coach_learnings;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'coach_learning_no_company' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(auth.uid(), v_company, 'admin') THEN
    RAISE EXCEPTION 'coach_learning_admin_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.coach_learnings
    WHERE id = _learning_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coach_learning_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.company_id <> v_company THEN
    RAISE EXCEPTION 'coach_learning_cross_tenant' USING ERRCODE = '42501';
  END IF;

  UPDATE public.coach_learnings
     SET status = 'archived',
         archived_at = now(),
         updated_at = now()
   WHERE id = _learning_id;
END;
$$;

-- increment_coach_learning_usage
CREATE OR REPLACE FUNCTION public.increment_coach_learning_usage(_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_count integer;
BEGIN
  IF v_company IS NULL OR _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  WITH upd AS (
    UPDATE public.coach_learnings
       SET usage_count = usage_count + 1,
           last_used_at = now()
     WHERE id = ANY(_ids)
       AND company_id = v_company
       AND status = 'active'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM upd;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_coach_learning(text, text, text, text, text, text, text, smallint, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_coach_learning(uuid, text, text, text, text, text, text, text, smallint, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_coach_learning(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_coach_learning_usage(uuid[]) TO authenticated;
