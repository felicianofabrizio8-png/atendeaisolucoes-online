-- Controles financeiros e operacionais do shadow OpenAI da Bruna.
-- A migration é aditiva e deve ser aplicada/validada separadamente antes de
-- qualquer ativação. Sem ela, o guard server-only falha fechado.

CREATE TABLE IF NOT EXISTS public.sales_agent_shadow_budget_periods (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  budget_microusd BIGINT NOT NULL CHECK (budget_microusd > 0),
  reserved_microusd BIGINT NOT NULL DEFAULT 0 CHECK (reserved_microusd >= 0),
  consumed_microusd BIGINT NOT NULL DEFAULT 0 CHECK (consumed_microusd >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, period_start),
  CHECK (period_end > period_start),
  CHECK (reserved_microusd + consumed_microusd <= budget_microusd)
);

CREATE TABLE IF NOT EXISTS public.sales_agent_shadow_budget_reservations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL,
  reserved_microusd BIGINT NOT NULL CHECK (reserved_microusd > 0),
  actual_microusd BIGINT NOT NULL DEFAULT 0 CHECK (actual_microusd >= 0),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'committed', 'released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, idempotency_key),
  FOREIGN KEY (company_id, period_start)
    REFERENCES public.sales_agent_shadow_budget_periods(company_id, period_start)
    ON DELETE CASCADE
);

ALTER TABLE public.sales_agent_shadow_budget_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_agent_shadow_budget_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shadow budget admin read" ON public.sales_agent_shadow_budget_periods
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), company_id, 'admin'::app_role));
CREATE POLICY "shadow reservation admin read" ON public.sales_agent_shadow_budget_reservations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), company_id, 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.sales_agent_shadow_budget_reserve(
  p_company_id UUID,
  p_period_start TIMESTAMPTZ,
  p_period_end TIMESTAMPTZ,
  p_budget_microusd BIGINT,
  p_idempotency_key TEXT,
  p_reserve_microusd BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE period_row public.sales_agent_shadow_budget_periods%ROWTYPE;
DECLARE reservation_row public.sales_agent_shadow_budget_reservations%ROWTYPE;
BEGIN
  IF p_reserve_microusd <= 0 OR p_budget_microusd <= 0 OR p_idempotency_key = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_reservation');
  END IF;

  INSERT INTO public.sales_agent_shadow_budget_periods(company_id, period_start, period_end, budget_microusd)
  VALUES (p_company_id, p_period_start, p_period_end, p_budget_microusd)
  ON CONFLICT (company_id, period_start) DO NOTHING;

  SELECT * INTO period_row FROM public.sales_agent_shadow_budget_periods
    WHERE company_id = p_company_id AND period_start = p_period_start FOR UPDATE;

  SELECT * INTO reservation_row FROM public.sales_agent_shadow_budget_reservations
    WHERE company_id = p_company_id AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF reservation_row.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'reservation_id', reservation_row.id, 'status', reservation_row.status);
  END IF;

  IF period_row.budget_microusd <> p_budget_microusd
     OR period_row.reserved_microusd + period_row.consumed_microusd + p_reserve_microusd > period_row.budget_microusd THEN
    RETURN jsonb_build_object('ok', false, 'code', 'budget_exhausted');
  END IF;

  INSERT INTO public.sales_agent_shadow_budget_reservations(company_id, period_start, idempotency_key, reserved_microusd)
    VALUES (p_company_id, p_period_start, p_idempotency_key, p_reserve_microusd)
    RETURNING * INTO reservation_row;
  UPDATE public.sales_agent_shadow_budget_periods
    SET reserved_microusd = reserved_microusd + p_reserve_microusd, updated_at = now()
    WHERE company_id = p_company_id AND period_start = p_period_start;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'reservation_id', reservation_row.id, 'status', 'reserved');
END;
$$;
REVOKE ALL ON FUNCTION public.sales_agent_shadow_budget_reserve(UUID, TIMESTAMPTZ, TIMESTAMPTZ, BIGINT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sales_agent_shadow_budget_reserve(UUID, TIMESTAMPTZ, TIMESTAMPTZ, BIGINT, TEXT, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.sales_agent_shadow_budget_reconcile(
  p_company_id UUID,
  p_reservation_id UUID,
  p_actual_microusd BIGINT,
  p_commit BOOLEAN
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE reservation_row public.sales_agent_shadow_budget_reservations%ROWTYPE;
DECLARE final_actual BIGINT := GREATEST(COALESCE(p_actual_microusd, 0), 0);
BEGIN
  SELECT * INTO reservation_row FROM public.sales_agent_shadow_budget_reservations
    WHERE id = p_reservation_id AND company_id = p_company_id FOR UPDATE;
  IF reservation_row.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'reservation_not_found'); END IF;
  IF reservation_row.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'status', reservation_row.status, 'actual_microusd', reservation_row.actual_microusd);
  END IF;
  IF p_commit AND final_actual > reservation_row.reserved_microusd THEN
    UPDATE public.sales_agent_shadow_budget_reservations SET status = 'released', updated_at = now() WHERE id = reservation_row.id;
    UPDATE public.sales_agent_shadow_budget_periods SET reserved_microusd = reserved_microusd - reservation_row.reserved_microusd, updated_at = now()
      WHERE company_id = p_company_id AND period_start = reservation_row.period_start;
    RETURN jsonb_build_object('ok', false, 'code', 'usage_exceeded_reservation');
  END IF;
  IF p_commit THEN
    UPDATE public.sales_agent_shadow_budget_reservations SET status = 'committed', actual_microusd = final_actual, updated_at = now() WHERE id = reservation_row.id;
    UPDATE public.sales_agent_shadow_budget_periods
      SET reserved_microusd = reserved_microusd - reservation_row.reserved_microusd,
          consumed_microusd = consumed_microusd + final_actual, updated_at = now()
      WHERE company_id = p_company_id AND period_start = reservation_row.period_start;
  ELSE
    UPDATE public.sales_agent_shadow_budget_reservations SET status = 'released', updated_at = now() WHERE id = reservation_row.id;
    UPDATE public.sales_agent_shadow_budget_periods SET reserved_microusd = reserved_microusd - reservation_row.reserved_microusd, updated_at = now()
      WHERE company_id = p_company_id AND period_start = reservation_row.period_start;
  END IF;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'status', CASE WHEN p_commit THEN 'committed' ELSE 'released' END, 'actual_microusd', final_actual);
END;
$$;
REVOKE ALL ON FUNCTION public.sales_agent_shadow_budget_reconcile(UUID, UUID, BIGINT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sales_agent_shadow_budget_reconcile(UUID, UUID, BIGINT, BOOLEAN) TO service_role;
