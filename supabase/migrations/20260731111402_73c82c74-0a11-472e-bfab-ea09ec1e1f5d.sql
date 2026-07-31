-- ============================================================
-- SPRINT 4 · FASE 5 — Painel de desempenho dos aprendizados
-- Somente leitura. Nenhuma alteração de dados ou de regra de negócio.
-- ============================================================

-- 1) Indicador de saúde — determinístico e centralizado.
CREATE OR REPLACE FUNCTION public.coach_learning_health(
  _status text,
  _confidence numeric,
  _success_rate numeric,
  _samples integer,
  _negative integer,
  _usage integer,
  _retrieved integer
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _status = 'archived' THEN 'archived'
    WHEN COALESCE(_samples, 0) = 0 AND COALESCE(_retrieved, 0) = 0 THEN 'no_evidence'
    WHEN COALESCE(_negative, 0) >= 3 AND COALESCE(_success_rate, 0.5) < 0.40 THEN 'negative_recurring'
    WHEN COALESCE(_confidence, 0) < 0.35 THEN 'low_confidence'
    WHEN COALESCE(_samples, 0) > 0 AND COALESCE(_success_rate, 0.5) < 0.50 THEN 'attention'
    WHEN COALESCE(_usage, 0) = 0 AND COALESCE(_retrieved, 0) < 3 THEN 'low_usage'
    ELSE 'healthy'
  END
$$;

REVOKE ALL ON FUNCTION public.coach_learning_health(text, numeric, numeric, integer, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_learning_health(text, numeric, numeric, integer, integer, integer, integer) TO authenticated, service_role;

-- 2) Índices de apoio (histórico por aprendizado / período).
CREATE INDEX IF NOT EXISTS idx_clr_learning_created
  ON public.coach_learning_retrievals (learning_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clr_company_created
  ON public.coach_learning_retrievals (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clfe_learning_created
  ON public.coach_learning_feedback_events (learning_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clfe_company_created
  ON public.coach_learning_feedback_events (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coach_learnings_company_status
  ON public.coach_learnings (company_id, status);

-- 3) Listagem paginada com métricas.
CREATE OR REPLACE FUNCTION public.list_coach_learning_performance(
  _statuses text[] DEFAULT NULL,
  _search text DEFAULT NULL,
  _min_confidence numeric DEFAULT NULL,
  _max_confidence numeric DEFAULT NULL,
  _min_success numeric DEFAULT NULL,
  _max_success numeric DEFAULT NULL,
  _min_samples integer DEFAULT NULL,
  _min_usage integer DEFAULT NULL,
  _min_priority integer DEFAULT NULL,
  _health text DEFAULT NULL,
  _strategy text DEFAULT NULL,
  _only_negative boolean DEFAULT false,
  _only_unused boolean DEFAULT false,
  _only_no_feedback boolean DEFAULT false,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL,
  _sort text DEFAULT 'priority',
  _page integer DEFAULT 1,
  _page_size integer DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  title text,
  category text,
  product_ref text,
  status text,
  priority integer,
  confidence numeric,
  success_rate numeric,
  feedback_sample_count integer,
  positive_feedback_count integer,
  negative_feedback_count integer,
  usage_count integer,
  times_retrieved integer,
  last_used_at timestamptz,
  last_retrieved_at timestamptz,
  last_feedback_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  version integer,
  health text,
  period_retrievals bigint,
  period_contextual bigint,
  period_fallback bigint,
  period_positive bigint,
  period_negative bigint,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_page integer := GREATEST(1, COALESCE(_page, 1));
  v_size integer := LEAST(100, GREATEST(1, COALESCE(_page_size, 20)));
  v_sort text := COALESCE(_sort, 'priority');
  v_from timestamptz := _from;
  v_to timestamptz := _to;
  v_search text := NULLIF(btrim(COALESCE(_search, '')), '');
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(auth.uid(), v_company, 'admin'::app_role) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from > v_to THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = '22007';
  END IF;
  IF v_sort NOT IN (
    'priority','usage_desc','usage_asc','confidence_desc','confidence_asc',
    'success_desc','success_asc','feedback_desc','recent','oldest','retrieved_desc'
  ) THEN
    v_sort := 'priority';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      l.*,
      public.coach_learning_health(
        l.status, l.confidence, l.success_rate,
        l.feedback_sample_count, l.negative_feedback_count,
        l.usage_count, l.times_retrieved
      ) AS health_code
    FROM public.coach_learnings l
    WHERE l.company_id = v_company
  ),
  metrics AS (
    SELECT
      b.*,
      COALESCE(r.n, 0) AS m_retrievals,
      COALESCE(r.contextual, 0) AS m_contextual,
      COALESCE(r.fallback, 0) AS m_fallback,
      COALESCE(f.pos, 0) AS m_pos,
      COALESCE(f.neg, 0) AS m_neg
    FROM base b
    LEFT JOIN LATERAL (
      SELECT
        count(*) AS n,
        count(*) FILTER (WHERE COALESCE(cr.ranking_metadata->>'strategy', '') = 'contextual_v1') AS contextual,
        count(*) FILTER (WHERE COALESCE(cr.ranking_metadata->>'strategy', '') <> 'contextual_v1') AS fallback
      FROM public.coach_learning_retrievals cr
      WHERE cr.learning_id = b.id
        AND cr.company_id = v_company
        AND (v_from IS NULL OR cr.created_at >= v_from)
        AND (v_to IS NULL OR cr.created_at <= v_to)
    ) r ON true
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE fe.new_feedback = 'positive') AS pos,
        count(*) FILTER (WHERE fe.new_feedback = 'negative') AS neg
      FROM public.coach_learning_feedback_events fe
      WHERE fe.learning_id = b.id
        AND fe.company_id = v_company
        AND (v_from IS NULL OR fe.created_at >= v_from)
        AND (v_to IS NULL OR fe.created_at <= v_to)
    ) f ON true
  ),
  filtered AS (
    SELECT m.* FROM metrics m
    WHERE (_statuses IS NULL OR array_length(_statuses, 1) IS NULL OR m.status = ANY(_statuses))
      AND (_statuses IS NOT NULL OR m.status <> 'archived')
      AND (_min_confidence IS NULL OR m.confidence >= _min_confidence)
      AND (_max_confidence IS NULL OR m.confidence <= _max_confidence)
      AND (_min_success IS NULL OR m.success_rate >= _min_success)
      AND (_max_success IS NULL OR m.success_rate <= _max_success)
      AND (_min_samples IS NULL OR m.feedback_sample_count >= _min_samples)
      AND (_min_usage IS NULL OR m.usage_count >= _min_usage)
      AND (_min_priority IS NULL OR m.priority >= _min_priority)
      AND (_health IS NULL OR m.health_code = _health)
      AND (_strategy IS NULL OR (
        _strategy = 'contextual_v1' AND m.m_contextual > 0
      ) OR (
        _strategy = 'static_fallback' AND m.m_fallback > 0
      ))
      AND (NOT COALESCE(_only_negative, false) OR m.negative_feedback_count > 0)
      AND (NOT COALESCE(_only_unused, false) OR (m.usage_count = 0 AND m.times_retrieved = 0))
      AND (NOT COALESCE(_only_no_feedback, false) OR m.feedback_sample_count = 0)
      AND (
        v_search IS NULL
        OR m.title ILIKE '%' || v_search || '%'
        OR m.description ILIKE '%' || v_search || '%'
        OR m.rule_structured ILIKE '%' || v_search || '%'
        OR COALESCE(m.product_ref, '') ILIKE '%' || v_search || '%'
      )
  ),
  counted AS (
    SELECT f.*, count(*) OVER () AS n_total FROM filtered f
  )
  SELECT
    c.id, c.title, c.category, c.product_ref, c.status, c.priority,
    c.confidence, c.success_rate, c.feedback_sample_count,
    c.positive_feedback_count, c.negative_feedback_count,
    c.usage_count, c.times_retrieved,
    c.last_used_at, c.last_retrieved_at, c.last_feedback_at,
    c.created_at, c.updated_at, c.version,
    c.health_code,
    c.m_retrievals, c.m_contextual, c.m_fallback, c.m_pos, c.m_neg,
    c.n_total
  FROM counted c
  ORDER BY
    CASE WHEN v_sort = 'usage_desc' THEN c.usage_count END DESC NULLS LAST,
    CASE WHEN v_sort = 'usage_asc' THEN c.usage_count END ASC NULLS LAST,
    CASE WHEN v_sort = 'retrieved_desc' THEN c.times_retrieved END DESC NULLS LAST,
    CASE WHEN v_sort = 'confidence_desc' THEN c.confidence END DESC NULLS LAST,
    CASE WHEN v_sort = 'confidence_asc' THEN c.confidence END ASC NULLS LAST,
    CASE WHEN v_sort = 'success_desc' THEN c.success_rate END DESC NULLS LAST,
    CASE WHEN v_sort = 'success_asc' THEN c.success_rate END ASC NULLS LAST,
    CASE WHEN v_sort = 'feedback_desc' THEN c.feedback_sample_count END DESC NULLS LAST,
    CASE WHEN v_sort = 'recent' THEN c.updated_at END DESC NULLS LAST,
    CASE WHEN v_sort = 'oldest' THEN c.updated_at END ASC NULLS LAST,
    CASE WHEN v_sort = 'priority' THEN c.priority END DESC NULLS LAST,
    c.updated_at DESC,
    c.id
  OFFSET (v_page - 1) * v_size
  LIMIT v_size;
END;
$$;

REVOKE ALL ON FUNCTION public.list_coach_learning_performance(text[], text, numeric, numeric, numeric, numeric, integer, integer, integer, text, text, boolean, boolean, boolean, timestamptz, timestamptz, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_coach_learning_performance(text[], text, numeric, numeric, numeric, numeric, integer, integer, integer, text, text, boolean, boolean, boolean, timestamptz, timestamptz, text, integer, integer) TO authenticated, service_role;

-- 4) Resumo agregado.
CREATE OR REPLACE FUNCTION public.coach_learning_performance_summary(
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_result jsonb;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(auth.uid(), v_company, 'admin'::app_role) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF _from IS NOT NULL AND _to IS NOT NULL AND _from > _to THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = '22007';
  END IF;

  SELECT jsonb_build_object(
    'active', COALESCE(l.active, 0),
    'paused', COALESCE(l.paused, 0),
    'archived', COALESCE(l.archived, 0),
    'total', COALESCE(l.total, 0),
    'totalUsage', COALESCE(l.usage_sum, 0),
    'totalRetrieved', COALESCE(l.retrieved_sum, 0),
    'lowConfidence', COALESCE(l.low_conf, 0),
    'neverUsed', COALESCE(l.never_used, 0),
    'noFeedback', COALESCE(l.no_feedback, 0),
    'negativeHistory', COALESCE(l.negative_hist, 0),
    'avgConfidence', COALESCE(round(l.avg_conf, 4), 0),
    'avgSuccessRate', COALESCE(round(l.avg_succ, 4), 0),
    'feedbackPositive', COALESCE(f.pos, 0),
    'feedbackNegative', COALESCE(f.neg, 0),
    'feedbackTotal', COALESCE(f.pos, 0) + COALESCE(f.neg, 0),
    'positiveRate', CASE
      WHEN COALESCE(f.pos, 0) + COALESCE(f.neg, 0) = 0 THEN NULL
      ELSE round(COALESCE(f.pos, 0)::numeric / (COALESCE(f.pos, 0) + COALESCE(f.neg, 0)), 4)
    END,
    'retrievalsContextual', COALESCE(r.contextual, 0),
    'retrievalsFallback', COALESCE(r.fallback, 0),
    'retrievalsTotal', COALESCE(r.n, 0),
    'contextualShare', CASE
      WHEN COALESCE(r.n, 0) = 0 THEN NULL
      ELSE round(COALESCE(r.contextual, 0)::numeric / r.n, 4)
    END,
    'fallbackShare', CASE
      WHEN COALESCE(r.n, 0) = 0 THEN NULL
      ELSE round(COALESCE(r.fallback, 0)::numeric / r.n, 4)
    END,
    'periodFrom', _from,
    'periodTo', _to
  ) INTO v_result
  FROM (
    SELECT
      count(*) FILTER (WHERE status = 'active') AS active,
      count(*) FILTER (WHERE status = 'paused') AS paused,
      count(*) FILTER (WHERE status = 'archived') AS archived,
      count(*) AS total,
      sum(usage_count) AS usage_sum,
      sum(times_retrieved) AS retrieved_sum,
      count(*) FILTER (WHERE confidence < 0.35 AND status <> 'archived') AS low_conf,
      count(*) FILTER (WHERE usage_count = 0 AND times_retrieved = 0 AND status <> 'archived') AS never_used,
      count(*) FILTER (WHERE feedback_sample_count = 0 AND status <> 'archived') AS no_feedback,
      count(*) FILTER (WHERE negative_feedback_count > 0) AS negative_hist,
      avg(confidence) AS avg_conf,
      avg(success_rate) AS avg_succ
    FROM public.coach_learnings WHERE company_id = v_company
  ) l
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE new_feedback = 'positive') AS pos,
      count(*) FILTER (WHERE new_feedback = 'negative') AS neg
    FROM public.coach_learning_feedback_events
    WHERE company_id = v_company
      AND (_from IS NULL OR created_at >= _from)
      AND (_to IS NULL OR created_at <= _to)
  ) f ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*) AS n,
      count(*) FILTER (WHERE COALESCE(ranking_metadata->>'strategy', '') = 'contextual_v1') AS contextual,
      count(*) FILTER (WHERE COALESCE(ranking_metadata->>'strategy', '') <> 'contextual_v1') AS fallback
    FROM public.coach_learning_retrievals
    WHERE company_id = v_company
      AND (_from IS NULL OR created_at >= _from)
      AND (_to IS NULL OR created_at <= _to)
  ) r ON true;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.coach_learning_performance_summary(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_learning_performance_summary(timestamptz, timestamptz) TO authenticated, service_role;