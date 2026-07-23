-- =========================================================================
-- BLOCO 4 — Coach Learnings: Intelligence Base
-- Rollback: DROP FUNCTION restore_coach_learning_version, find_similar_coach_learning,
--          record_coach_learning_retrieval, coach_learning_compute_hash,
--          coach_learning_normalize_text, coach_learnings_set_content_hash;
--          DROP TABLE coach_learning_retrievals;
--          DROP INDEX coach_learnings_company_hash_unique, coach_learnings_trgm_title,
--                     coach_learnings_trgm_rule;
--          ALTER TABLE coach_learnings DROP COLUMN content_hash, updated_by,
--                                                  times_retrieved, last_retrieved_at;
--          ALTER TABLE coach_learning_versions DROP COLUMN change_reason, origin,
--                                                          prompt_version, metadata;
--          Recreate previous update_coach_learning / create_coach_learning signatures.
-- =========================================================================

-- 1. Extension --------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Normalization + hash helpers (IMMUTABLE) -------------------------------
CREATE OR REPLACE FUNCTION public.coach_learning_normalize_text(_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        lower(
          translate(
            coalesce(_input, ''),
            'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
            'aaaaaaeeeeiiiiooooouuuucnaaaaaaeeeeiiiiooooouuuucn'
          )
        ),
        '[[:punct:]]+', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

COMMENT ON FUNCTION public.coach_learning_normalize_text IS
'Normaliza texto para comparação: minúsculas, sem acentos, sem pontuação, espaços colapsados. IMMUTABLE.';

CREATE OR REPLACE FUNCTION public.coach_learning_compute_hash(
  _category text,
  _title text,
  _rule_structured text,
  _product_ref text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5(
    coalesce(public.coach_learning_normalize_text(_category), '')       || '|' ||
    coalesce(public.coach_learning_normalize_text(_title), '')          || '|' ||
    coalesce(public.coach_learning_normalize_text(_rule_structured), '')|| '|' ||
    coalesce(public.coach_learning_normalize_text(_product_ref), '')
  );
$$;

COMMENT ON FUNCTION public.coach_learning_compute_hash IS
'Identidade de conteúdo de um aprendizado. NÃO inclui descrição, exemplos, prioridade, autor ou status.';

-- 3. New columns on coach_learnings -----------------------------------------
ALTER TABLE public.coach_learnings
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS times_retrieved integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retrieved_at timestamptz;

COMMENT ON COLUMN public.coach_learnings.content_hash IS
'MD5 do conteúdo normalizado (categoria+título+regra+produto). Bloqueia duplicidade exata dentro da mesma empresa.';
COMMENT ON COLUMN public.coach_learnings.updated_by IS
'Último usuário a alterar. Sempre derivado de auth.uid() no servidor.';
COMMENT ON COLUMN public.coach_learnings.times_retrieved IS
'Contagem de vezes que o Coach selecionou e incluiu esta regra no contexto (best-effort).';
COMMENT ON COLUMN public.coach_learnings.last_retrieved_at IS
'Última vez em que a regra foi recuperada pelo Coach.';
COMMENT ON COLUMN public.coach_learnings.usage_count IS
'Aplicações confirmadas: incrementado quando há evidência positiva (ex.: feedback 👍).';

-- Backfill hash for existing rows (base vazia hoje, mas defensivo).
UPDATE public.coach_learnings
   SET content_hash = public.coach_learning_compute_hash(category, title, rule_structured, product_ref)
 WHERE content_hash IS NULL;

ALTER TABLE public.coach_learnings
  ALTER COLUMN content_hash SET NOT NULL;

-- Trigger BEFORE INSERT/UPDATE para manter content_hash sempre coerente.
CREATE OR REPLACE FUNCTION public.coach_learnings_set_content_hash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.content_hash := public.coach_learning_compute_hash(
    NEW.category, NEW.title, NEW.rule_structured, NEW.product_ref
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_coach_learnings_content_hash ON public.coach_learnings;
CREATE TRIGGER trg_coach_learnings_content_hash
BEFORE INSERT OR UPDATE OF category, title, rule_structured, product_ref
ON public.coach_learnings
FOR EACH ROW EXECUTE FUNCTION public.coach_learnings_set_content_hash();

-- Duplicidade exata: única constraint parcial. Arquivados não bloqueiam.
CREATE UNIQUE INDEX IF NOT EXISTS coach_learnings_company_hash_unique
  ON public.coach_learnings (company_id, content_hash)
  WHERE status <> 'archived';

-- Trigram para busca de semelhantes.
CREATE INDEX IF NOT EXISTS coach_learnings_trgm_title
  ON public.coach_learnings USING gin (public.coach_learning_normalize_text(title) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS coach_learnings_trgm_rule
  ON public.coach_learnings USING gin (public.coach_learning_normalize_text(rule_structured) gin_trgm_ops);

-- 4. New columns on coach_learning_versions ---------------------------------
ALTER TABLE public.coach_learning_versions
  ADD COLUMN IF NOT EXISTS change_reason text,
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual_edit',
  ADD COLUMN IF NOT EXISTS prompt_version text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.coach_learning_versions
  DROP CONSTRAINT IF EXISTS coach_learning_versions_origin_check;
ALTER TABLE public.coach_learning_versions
  ADD CONSTRAINT coach_learning_versions_origin_check
  CHECK (origin IN ('teach_mode','manual_edit','restore','migration','system'));

COMMENT ON COLUMN public.coach_learning_versions.origin IS
'Origem controlada: teach_mode, manual_edit, restore, migration, system.';
COMMENT ON COLUMN public.coach_learning_versions.metadata IS
'Dados auxiliares (ex.: restored_from_version). Não deve conter mensagens completas do cliente.';

-- 5. Retrieval telemetry table ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.coach_learning_retrievals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  learning_id uuid NOT NULL REFERENCES public.coach_learnings(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  generation_ref text NOT NULL,
  conversation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_learning_retrievals_unique_per_generation
    UNIQUE (learning_id, generation_ref)
);

COMMENT ON TABLE public.coach_learning_retrievals IS
'Registro best-effort de aprendizados recuperados pelo Coach por geração. Idempotente via UNIQUE(learning_id, generation_ref). Retenção sugerida: 90 dias (implementar via cron externo se necessário).';

GRANT SELECT ON public.coach_learning_retrievals TO authenticated;
GRANT ALL    ON public.coach_learning_retrievals TO service_role;

ALTER TABLE public.coach_learning_retrievals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coach_learning_retrievals_select_own_company ON public.coach_learning_retrievals;
CREATE POLICY coach_learning_retrievals_select_own_company
  ON public.coach_learning_retrievals FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

CREATE INDEX IF NOT EXISTS coach_learning_retrievals_company_created
  ON public.coach_learning_retrievals (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coach_learning_retrievals_learning_created
  ON public.coach_learning_retrievals (learning_id, created_at DESC);

-- 6. Recreate create_coach_learning with origin/prompt_version/metadata ----
DROP FUNCTION IF EXISTS public.create_coach_learning(
  text, text, text, text, text, text, text, smallint, numeric, uuid
);

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
  _source_conversation_id uuid DEFAULT NULL,
  _origin text DEFAULT 'teach_mode',
  _prompt_version text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
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
  IF _origin NOT IN ('teach_mode','manual_edit','restore','migration','system') THEN
    RAISE EXCEPTION 'coach_learning_invalid_origin' USING ERRCODE = '22023';
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
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'learning_duplicate_conflict' USING ERRCODE = 'P0001';
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
$$;

REVOKE ALL ON FUNCTION public.create_coach_learning(
  text, text, text, text, text, text, text, smallint, numeric, uuid, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_coach_learning(
  text, text, text, text, text, text, text, smallint, numeric, uuid, text, text, jsonb
) TO authenticated;

-- 7. Recreate update_coach_learning with optimistic locking ----------------
DROP FUNCTION IF EXISTS public.update_coach_learning(
  uuid, text, text, text, text, text, text, text, smallint, text, numeric
);

CREATE OR REPLACE FUNCTION public.update_coach_learning(
  _learning_id uuid,
  _expected_version integer,
  _title text,
  _description text,
  _rule_structured text,
  _category text,
  _product_ref text DEFAULT NULL,
  _positive_example text DEFAULT NULL,
  _negative_example text DEFAULT NULL,
  _priority smallint DEFAULT NULL,
  _status text DEFAULT NULL,
  _confidence numeric DEFAULT NULL,
  _origin text DEFAULT 'manual_edit',
  _change_reason text DEFAULT NULL,
  _prompt_version text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_row public.coach_learnings;
  v_new_version integer;
  v_effective_status text;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'coach_learning_no_company' USING ERRCODE = '42501';
  END IF;
  IF _expected_version IS NULL THEN
    RAISE EXCEPTION 'coach_learning_expected_version_required' USING ERRCODE = '22023';
  END IF;
  IF _origin NOT IN ('teach_mode','manual_edit','restore','migration','system') THEN
    RAISE EXCEPTION 'coach_learning_invalid_origin' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.coach_learnings WHERE id = _learning_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coach_learning_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.company_id <> v_company THEN
    RAISE EXCEPTION 'coach_learning_cross_tenant' USING ERRCODE = '42501';
  END IF;
  IF v_row.version <> _expected_version THEN
    RAISE EXCEPTION 'learning_version_conflict' USING ERRCODE = 'P0001';
  END IF;

  v_new_version := v_row.version + 1;
  v_effective_status := COALESCE(_status, v_row.status);

  BEGIN
    UPDATE public.coach_learnings
       SET title = _title,
           description = _description,
           rule_structured = _rule_structured,
           category = _category,
           product_ref = _product_ref,
           positive_example = _positive_example,
           negative_example = _negative_example,
           priority = GREATEST(0, LEAST(100, COALESCE(_priority, v_row.priority))),
           status = v_effective_status,
           confidence = GREATEST(0, LEAST(1, COALESCE(_confidence, v_row.confidence))),
           version = v_new_version,
           updated_by = auth.uid(),
           updated_at = now()
     WHERE id = _learning_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'learning_duplicate_conflict' USING ERRCODE = 'P0001';
  END;

  INSERT INTO public.coach_learning_versions (
    learning_id, company_id, version, category, product_ref, title, description,
    rule_structured, positive_example, negative_example, priority, status,
    confidence, edited_by, origin, change_reason, prompt_version, metadata
  ) VALUES (
    _learning_id, v_company, v_new_version, _category, _product_ref, _title, _description,
    _rule_structured, _positive_example, _negative_example,
    GREATEST(0, LEAST(100, COALESCE(_priority, v_row.priority))),
    v_effective_status,
    GREATEST(0, LEAST(1, COALESCE(_confidence, v_row.confidence))),
    auth.uid(), _origin, _change_reason, _prompt_version, COALESCE(_metadata, '{}'::jsonb)
  );

  RETURN v_new_version;
END;
$$;

REVOKE ALL ON FUNCTION public.update_coach_learning(
  uuid, integer, text, text, text, text, text, text, text, smallint, text, numeric, text, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_coach_learning(
  uuid, integer, text, text, text, text, text, text, text, smallint, text, numeric, text, text, text, jsonb
) TO authenticated;

-- 8. Restore version RPC ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_coach_learning_version(
  _learning_id uuid,
  _target_version integer,
  _expected_version integer,
  _change_reason text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_row public.coach_learnings;
  v_target public.coach_learning_versions;
  v_new_version integer;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'coach_learning_no_company' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.coach_learnings WHERE id = _learning_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coach_learning_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.company_id <> v_company THEN
    RAISE EXCEPTION 'coach_learning_cross_tenant' USING ERRCODE = '42501';
  END IF;
  IF v_row.version <> _expected_version THEN
    RAISE EXCEPTION 'learning_version_conflict' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_target FROM public.coach_learning_versions
   WHERE learning_id = _learning_id AND version = _target_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coach_learning_version_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_new_version := v_row.version + 1;

  BEGIN
    UPDATE public.coach_learnings
       SET title = v_target.title,
           description = v_target.description,
           rule_structured = v_target.rule_structured,
           category = v_target.category,
           product_ref = v_target.product_ref,
           positive_example = v_target.positive_example,
           negative_example = v_target.negative_example,
           priority = v_target.priority,
           confidence = v_target.confidence,
           version = v_new_version,
           updated_by = auth.uid(),
           updated_at = now()
     WHERE id = _learning_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'learning_duplicate_conflict' USING ERRCODE = 'P0001';
  END;

  INSERT INTO public.coach_learning_versions (
    learning_id, company_id, version, category, product_ref, title, description,
    rule_structured, positive_example, negative_example, priority, status,
    confidence, edited_by, origin, change_reason, prompt_version, metadata
  ) VALUES (
    _learning_id, v_company, v_new_version, v_target.category, v_target.product_ref,
    v_target.title, v_target.description, v_target.rule_structured,
    v_target.positive_example, v_target.negative_example, v_target.priority,
    v_row.status, v_target.confidence, auth.uid(),
    'restore', _change_reason, v_target.prompt_version,
    jsonb_build_object('restored_from_version', _target_version)
  );

  RETURN v_new_version;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_coach_learning_version FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_coach_learning_version TO authenticated;

-- 9. Similarity search RPC -------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_similar_coach_learning(
  _category text,
  _title text,
  _rule_structured text,
  _description text DEFAULT NULL,
  _product_ref text DEFAULT NULL,
  _limit integer DEFAULT 5
) RETURNS TABLE (
  id uuid,
  version integer,
  status text,
  category text,
  title text,
  description text,
  rule_structured text,
  product_ref text,
  priority smallint,
  updated_at timestamptz,
  content_hash text,
  score numeric,
  classification text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_hash text;
  v_norm_title text;
  v_norm_rule text;
  v_norm_desc text;
  v_norm_product text;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'coach_learning_no_company' USING ERRCODE = '42501';
  END IF;

  v_hash         := public.coach_learning_compute_hash(_category, _title, _rule_structured, _product_ref);
  v_norm_title   := public.coach_learning_normalize_text(_title);
  v_norm_rule    := public.coach_learning_normalize_text(_rule_structured);
  v_norm_desc    := public.coach_learning_normalize_text(_description);
  v_norm_product := public.coach_learning_normalize_text(_product_ref);

  RETURN QUERY
  WITH candidates AS (
    SELECT
      l.id, l.version, l.status, l.category, l.title, l.description, l.rule_structured,
      l.product_ref, l.priority, l.updated_at, l.content_hash,
      (
        similarity(public.coach_learning_normalize_text(l.rule_structured), v_norm_rule) * 0.45 +
        similarity(public.coach_learning_normalize_text(l.title), v_norm_title)           * 0.30 +
        CASE WHEN v_norm_desc <> ''
             THEN similarity(public.coach_learning_normalize_text(l.description), v_norm_desc) * 0.15
             ELSE 0 END +
        CASE WHEN l.category = _category THEN 0.05 ELSE 0 END +
        CASE WHEN v_norm_product <> ''
              AND public.coach_learning_normalize_text(l.product_ref) = v_norm_product
             THEN 0.05 ELSE 0 END
      )::numeric AS raw_score
    FROM public.coach_learnings l
    WHERE l.company_id = v_company
      AND l.status <> 'archived'
  )
  SELECT c.id, c.version, c.status, c.category, c.title, c.description, c.rule_structured,
         c.product_ref, c.priority, c.updated_at, c.content_hash,
         round(c.raw_score, 4) AS score,
         CASE
           WHEN c.content_hash = v_hash THEN 'exact'
           WHEN c.raw_score >= 0.75 THEN 'highly_similar'
           WHEN c.raw_score >= 0.45 THEN 'related'
           ELSE 'new'
         END AS classification
    FROM candidates c
   WHERE c.content_hash = v_hash OR c.raw_score >= 0.35
   ORDER BY (c.content_hash = v_hash) DESC, c.raw_score DESC
   LIMIT GREATEST(1, LEAST(10, COALESCE(_limit, 5)));
END;
$$;

REVOKE ALL ON FUNCTION public.find_similar_coach_learning FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_similar_coach_learning TO authenticated;

-- 10. Retrieval telemetry RPC (idempotent per generation) ------------------
CREATE OR REPLACE FUNCTION public.record_coach_learning_retrieval(
  _ids uuid[],
  _generation_ref text,
  _conversation_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_inserted integer := 0;
BEGIN
  IF v_company IS NULL
     OR _ids IS NULL
     OR array_length(_ids, 1) IS NULL
     OR _generation_ref IS NULL
     OR length(btrim(_generation_ref)) = 0 THEN
    RETURN 0;
  END IF;

  WITH valid_ids AS (
    SELECT id, version
      FROM public.coach_learnings
     WHERE id = ANY(_ids) AND company_id = v_company
  ),
  ins AS (
    INSERT INTO public.coach_learning_retrievals (
      company_id, learning_id, version_number, generation_ref, conversation_id
    )
    SELECT v_company, v.id, v.version, _generation_ref, _conversation_id
      FROM valid_ids v
    ON CONFLICT (learning_id, generation_ref) DO NOTHING
    RETURNING learning_id
  ),
  upd AS (
    UPDATE public.coach_learnings
       SET times_retrieved = times_retrieved + 1,
           last_retrieved_at = now()
     WHERE id IN (SELECT learning_id FROM ins)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  RETURN COALESCE(v_inserted, 0);
EXCEPTION WHEN OTHERS THEN
  RETURN 0;
END;
$$;

REVOKE ALL ON FUNCTION public.record_coach_learning_retrieval FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_coach_learning_retrieval TO authenticated;

-- =========================================================================
-- Fim BLOCO 4
-- =========================================================================