-- ===========================================================================
-- SPRINT 4 · FASE 4 — Ciclo de feedback e ajuste de confiança
--
-- PRINCÍPIO CENTRAL (define todo o desenho):
--   `confidence` e `success_rate` NÃO são acumuladores incrementais.
--   São FUNÇÕES PURAS E DETERMINÍSTICAS dos contadores.
--
--   Consequência: trocar 👍→👎 é apenas "decrementa um lado, incrementa o
--   outro, recalcula". Não existe deriva, não existe necessidade de guardar
--   o delta aplicado para desfazê-lo, e reprocessar duas vezes o mesmo
--   estado produz exatamente o mesmo valor. Idempotência e reversibilidade
--   saem de graça da matemática, não de bookkeeping frágil.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Contadores de desempenho (aditivo, defaults seguros, sem backfill
--    destrutivo: zero feedback = estado neutro correto).
-- ---------------------------------------------------------------------------
ALTER TABLE public.coach_learnings
  ADD COLUMN IF NOT EXISTS positive_feedback_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS negative_feedback_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feedback_sample_count      integer NOT NULL DEFAULT 0,
  -- Pesos: contagem ponderada por rank e score da recuperação. O peso é
  -- função pura da linha de retrieval, então reverter recalcula o mesmo
  -- valor sem precisar consultar o histórico.
  ADD COLUMN IF NOT EXISTS positive_feedback_weight   numeric(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS negative_feedback_weight   numeric(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS success_rate               numeric(5,4)  NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS last_feedback_at           timestamptz,
  ADD COLUMN IF NOT EXISTS last_positive_feedback_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_negative_feedback_at  timestamptz;

ALTER TABLE public.coach_learnings
  DROP CONSTRAINT IF EXISTS coach_learnings_feedback_counts_chk;
ALTER TABLE public.coach_learnings
  ADD CONSTRAINT coach_learnings_feedback_counts_chk
  CHECK (
    positive_feedback_count  >= 0 AND
    negative_feedback_count  >= 0 AND
    feedback_sample_count    >= 0 AND
    positive_feedback_weight >= 0 AND
    negative_feedback_weight >= 0 AND
    success_rate BETWEEN 0 AND 1
  );

-- Ranking consulta desempenho por empresa; índice parcial mantém barato.
CREATE INDEX IF NOT EXISTS coach_learnings_feedback_perf
  ON public.coach_learnings (company_id, success_rate DESC)
  WHERE status = 'active' AND feedback_sample_count > 0;

-- ---------------------------------------------------------------------------
-- 2. Auditoria — append-only, sem conteúdo sensível (sem prompt, sem
--    transcrição, sem token). Só identificadores e números.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coach_learning_feedback_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  learning_id         uuid NOT NULL REFERENCES public.coach_learnings(id) ON DELETE CASCADE,
  suggestion_id       uuid NOT NULL,
  actor_user_id       uuid,
  previous_feedback   text,
  new_feedback        text,
  transition          text NOT NULL,
  event_weight        numeric(6,4) NOT NULL DEFAULT 1,
  rank                smallint,
  final_score         numeric(6,2),
  confidence_before   numeric(4,3),
  confidence_after    numeric(4,3),
  success_rate_before numeric(5,4),
  success_rate_after  numeric(5,4),
  source              text NOT NULL DEFAULT 'coach_panel',
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_lfe_feedback_values_chk CHECK (
    (previous_feedback IS NULL OR previous_feedback IN ('positive','negative')) AND
    (new_feedback      IS NULL OR new_feedback      IN ('positive','negative'))
  )
);

GRANT SELECT ON public.coach_learning_feedback_events TO authenticated;
GRANT ALL    ON public.coach_learning_feedback_events TO service_role;

ALTER TABLE public.coach_learning_feedback_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coach_lfe_select_own_company ON public.coach_learning_feedback_events;
CREATE POLICY coach_lfe_select_own_company
  ON public.coach_learning_feedback_events
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

CREATE INDEX IF NOT EXISTS coach_lfe_company_created
  ON public.coach_learning_feedback_events (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coach_lfe_learning_created
  ON public.coach_learning_feedback_events (learning_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coach_lfe_suggestion
  ON public.coach_learning_feedback_events (suggestion_id);

-- ---------------------------------------------------------------------------
-- 3. Fórmulas centralizadas — IMMUTABLE, sem números mágicos espalhados.
--    Espelhadas em src/lib/coach-learnings/feedback-policy.ts, com teste
--    que compara as constantes contra este arquivo.
-- ---------------------------------------------------------------------------

-- Peso do evento: rank 1 vale mais que rank 5; score alto pesa mais.
-- Função PURA da linha de retrieval → reverter recalcula o mesmo peso.
CREATE OR REPLACE FUNCTION public.coach_feedback_event_weight(
  _rank smallint, _final_score numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT round(
    GREATEST(0.50, LEAST(1.25,
      -- rank: 1.00 no topo, cai 0.08 por posição, piso 0.60
      GREATEST(0.60, 1.00 - 0.08 * (GREATEST(1, COALESCE(_rank, 3)) - 1))
      *
      -- score: 0..100 mapeado em 0.80..1.20
      (0.80 + 0.40 * (LEAST(100, GREATEST(0, COALESCE(_final_score, 50))) / 100.0))
    )), 4)::numeric;
$$;

-- success_rate — média bayesiana com prior neutro (alpha=beta=2).
-- Impede que 1 positivo vire 100% (=> 0.60) ou 1 negativo vire 0% (=> 0.40).
CREATE OR REPLACE FUNCTION public.coach_feedback_success_rate(
  _pos_weight numeric, _neg_weight numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT round(
    (GREATEST(0, COALESCE(_pos_weight,0)) + 2.0)
    / NULLIF(GREATEST(0, COALESCE(_pos_weight,0)) + GREATEST(0, COALESCE(_neg_weight,0)) + 4.0, 0)
  , 4)::numeric;
$$;

-- confidence — função pura dos contadores, NUNCA incremental.
-- Amortecida por amostra: n/(n+5). Com poucas amostras fica perto da base.
-- Limites duros [0.15, 0.95]: um único 👎 jamais destrói uma regra.
CREATE OR REPLACE FUNCTION public.coach_feedback_confidence(
  _success_rate numeric, _sample_count integer
) RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT round(
    GREATEST(0.150, LEAST(0.950,
      0.700 + (COALESCE(_success_rate, 0.5) - 0.5) * 0.600
              * (GREATEST(0, COALESCE(_sample_count,0))::numeric
                 / (GREATEST(0, COALESCE(_sample_count,0)) + 5.0))
    )), 3)::numeric;
$$;

-- ---------------------------------------------------------------------------
-- 4. RPC central atômica. SECURITY DEFINER, tenant derivado de auth.uid(),
--    company_id NUNCA vem do cliente.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_coach_suggestion_feedback_v2(
  _suggestion_id uuid,
  _feedback      text,          -- 'positive' | 'negative' | 'cleared'
  _source        text DEFAULT 'coach_panel'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user       uuid := auth.uid();
  v_company    uuid;
  v_sug        public.coach_suggestions;
  v_new        text;
  v_prev       text;
  v_transition text;
  v_affected   int := 0;
  v_metrics    int := 0;
  v_audits     int := 0;
  r            record;
  v_w          numeric;
  v_pw         numeric;
  v_nw         numeric;
  v_pc         int;
  v_nc         int;
  v_sc         int;
  v_sr_before  numeric;
  v_sr_after   numeric;
  v_cf_before  numeric;
  v_cf_after   numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'coach_feedback_unauthenticated' USING ERRCODE = '42501';
  END IF;

  v_new := CASE WHEN _feedback = 'cleared' THEN NULL ELSE _feedback END;
  IF v_new IS NOT NULL AND v_new NOT IN ('positive','negative') THEN
    RAISE EXCEPTION 'coach_feedback_invalid_status' USING ERRCODE = '22023';
  END IF;

  -- Tenant SEMPRE do usuário autenticado.
  SELECT company_id INTO v_company FROM public.profiles WHERE id = v_user;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'coach_feedback_no_company' USING ERRCODE = '42501';
  END IF;

  -- Trava a sugestão: o estado anterior persistido é a chave de
  -- idempotência. Nada depende do frontend para evitar duplicação.
  SELECT * INTO v_sug FROM public.coach_suggestions
   WHERE id = _suggestion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coach_feedback_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_sug.company_id <> v_company THEN
    RAISE EXCEPTION 'coach_feedback_cross_tenant' USING ERRCODE = '42501';
  END IF;

  v_prev := v_sug.feedback_status;

  -- Mesmo valor → no-op idempotente. Nenhuma contagem, nenhuma auditoria.
  IF v_prev IS NOT DISTINCT FROM v_new THEN
    RETURN jsonb_build_object(
      'ok', true, 'suggestionId', _suggestion_id,
      'previousFeedback', v_prev, 'currentFeedback', v_new,
      'changed', false, 'affectedLearnings', 0,
      'metricsUpdated', 0, 'auditEventsCreated', 0
    );
  END IF;

  v_transition := COALESCE(v_prev,'none') || '->' || COALESCE(v_new,'none');

  UPDATE public.coach_suggestions
     SET feedback_status     = v_new,
         feedback_user_id    = CASE WHEN v_new IS NULL THEN NULL ELSE v_user END,
         feedback_created_at = CASE WHEN v_new IS NULL THEN NULL ELSE now() END
   WHERE id = _suggestion_id;

  -- Atribuição: SOMENTE os aprendizados realmente usados nesta sugestão.
  -- Fonte de verdade = trace de retrieval (traz rank e score para o peso);
  -- fallback = learning_ids_used, para sugestões anteriores à Fase 3.
  FOR r IN
    SELECT l.id, l.company_id, l.confidence,
           l.positive_feedback_count, l.negative_feedback_count,
           l.positive_feedback_weight, l.negative_feedback_weight,
           l.success_rate,
           ret.rank, ret.final_score
      FROM public.coach_learnings l
      LEFT JOIN public.coach_learning_retrievals ret
             ON ret.learning_id = l.id
            AND ret.generation_ref = _suggestion_id::text
     WHERE l.company_id = v_company
       AND l.status <> 'archived'
       AND (
         EXISTS (SELECT 1 FROM public.coach_learning_retrievals r2
                  WHERE r2.learning_id = l.id
                    AND r2.generation_ref = _suggestion_id::text
                    AND r2.company_id = v_company)
         OR l.id = ANY(v_sug.learning_ids_used)
       )
     FOR UPDATE OF l
  LOOP
    v_affected := v_affected + 1;
    v_w := public.coach_feedback_event_weight(r.rank, r.final_score);

    v_pc := r.positive_feedback_count;
    v_nc := r.negative_feedback_count;
    v_pw := r.positive_feedback_weight;
    v_nw := r.negative_feedback_weight;

    -- Reverte o impacto anterior (se havia) e aplica o novo.
    -- O peso é o mesmo nos dois sentidos, então a reversão é exata.
    IF v_prev = 'positive' THEN
      v_pc := GREATEST(0, v_pc - 1); v_pw := GREATEST(0, v_pw - v_w);
    ELSIF v_prev = 'negative' THEN
      v_nc := GREATEST(0, v_nc - 1); v_nw := GREATEST(0, v_nw - v_w);
    END IF;
    IF v_new = 'positive' THEN
      v_pc := v_pc + 1; v_pw := v_pw + v_w;
    ELSIF v_new = 'negative' THEN
      v_nc := v_nc + 1; v_nw := v_nw + v_w;
    END IF;

    v_sc        := v_pc + v_nc;
    v_sr_before := r.success_rate;
    v_cf_before := r.confidence;
    v_sr_after  := public.coach_feedback_success_rate(v_pw, v_nw);
    v_cf_after  := public.coach_feedback_confidence(v_sr_after, v_sc);

    UPDATE public.coach_learnings
       SET positive_feedback_count   = v_pc,
           negative_feedback_count   = v_nc,
           feedback_sample_count     = v_sc,
           positive_feedback_weight  = v_pw,
           negative_feedback_weight  = v_nw,
           success_rate              = v_sr_after,
           confidence                = v_cf_after,
           last_feedback_at          = now(),
           last_positive_feedback_at = CASE WHEN v_new = 'positive'
                                            THEN now() ELSE last_positive_feedback_at END,
           last_negative_feedback_at = CASE WHEN v_new = 'negative'
                                            THEN now() ELSE last_negative_feedback_at END
     WHERE id = r.id;
    v_metrics := v_metrics + 1;

    INSERT INTO public.coach_learning_feedback_events (
      company_id, learning_id, suggestion_id, actor_user_id,
      previous_feedback, new_feedback, transition, event_weight,
      rank, final_score,
      confidence_before, confidence_after,
      success_rate_before, success_rate_after, source
    ) VALUES (
      v_company, r.id, _suggestion_id, v_user,
      v_prev, v_new, v_transition, v_w,
      r.rank, r.final_score,
      v_cf_before, v_cf_after,
      v_sr_before, v_sr_after, COALESCE(_source, 'coach_panel')
    );
    v_audits := v_audits + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'suggestionId', _suggestion_id,
    'previousFeedback', v_prev, 'currentFeedback', v_new,
    'changed', true, 'affectedLearnings', v_affected,
    'metricsUpdated', v_metrics, 'auditEventsCreated', v_audits
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_coach_suggestion_feedback_v2(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_coach_suggestion_feedback_v2(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.coach_feedback_event_weight(smallint, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.coach_feedback_success_rate(numeric, numeric)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.coach_feedback_confidence(numeric, integer)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_feedback_event_weight(smallint, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.coach_feedback_success_rate(numeric, numeric)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.coach_feedback_confidence(numeric, integer)    TO authenticated, service_role;