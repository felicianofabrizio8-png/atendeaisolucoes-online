-- Carteiras financeiras por empresa — base local, sem tarifas de consumo.
-- O plano mensal só é creditado por RPC após pagamento confirmado.

CREATE TABLE IF NOT EXISTS public.wallet_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL UNIQUE,
  monthly_price_cents bigint NOT NULL CHECK (monthly_price_cents > 0),
  monthly_ia_credit_cents bigint NOT NULL CHECK (monthly_ia_credit_cents >= 0),
  monthly_whatsapp_credit_cents bigint NOT NULL CHECK (monthly_whatsapp_credit_cents >= 0),
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.wallet_plan_versions
  (version, monthly_price_cents, monthly_ia_credit_cents, monthly_whatsapp_credit_cents, active)
VALUES (1, 49900, 5000, 5000, true)
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.company_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  wallet_kind text NOT NULL CHECK (wallet_kind IN ('ia', 'whatsapp')),
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  monthly_credit_cents bigint NOT NULL DEFAULT 0 CHECK (monthly_credit_cents >= 0),
  monthly_remaining_cents bigint NOT NULL DEFAULT 0 CHECK (monthly_remaining_cents >= 0),
  topup_balance_cents bigint NOT NULL DEFAULT 0 CHECK (topup_balance_cents >= 0),
  reserved_monthly_cents bigint NOT NULL DEFAULT 0 CHECK (reserved_monthly_cents >= 0),
  reserved_topup_cents bigint NOT NULL DEFAULT 0 CHECK (reserved_topup_cents >= 0),
  period_start date,
  period_end date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, wallet_kind)
);

CREATE TABLE IF NOT EXISTS public.wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES public.company_wallets(id) ON DELETE CASCADE,
  wallet_kind text NOT NULL CHECK (wallet_kind IN ('ia', 'whatsapp')),
  entry_type text NOT NULL CHECK (entry_type IN ('monthly_grant', 'topup', 'reserve', 'debit', 'release', 'refund', 'adjustment')),
  amount_cents bigint NOT NULL,
  idempotency_key text NOT NULL,
  reference_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.wallet_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES public.company_wallets(id) ON DELETE CASCADE,
  wallet_kind text NOT NULL CHECK (wallet_kind IN ('ia', 'whatsapp')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  monthly_cents bigint NOT NULL DEFAULT 0 CHECK (monthly_cents >= 0),
  topup_cents bigint NOT NULL DEFAULT 0 CHECK (topup_cents >= 0),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'committed', 'released', 'expired')),
  idempotency_key text NOT NULL,
  purpose text NOT NULL,
  reference_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, wallet_kind, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.wallet_price_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL,
  action_kind text NOT NULL CHECK (action_kind IN ('ia', 'whatsapp')),
  price_cents bigint CHECK (price_cents IS NULL OR price_cents > 0),
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action_kind, version)
);

INSERT INTO public.company_wallets (company_id, wallet_kind)
SELECT c.id, k.wallet_kind
FROM public.companies c
CROSS JOIN (VALUES ('ia'), ('whatsapp')) AS k(wallet_kind)
ON CONFLICT (company_id, wallet_kind) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_company_created
  ON public.wallet_ledger (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_reservations_expiry
  ON public.wallet_reservations (status, expires_at);

ALTER TABLE public.company_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_price_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallet admin read" ON public.company_wallets FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), company_id, 'admin'::app_role));
CREATE POLICY "wallet ledger admin read" ON public.wallet_ledger FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), company_id, 'admin'::app_role));
CREATE POLICY "wallet reservations admin read" ON public.wallet_reservations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), company_id, 'admin'::app_role));
CREATE POLICY "wallet plans read" ON public.wallet_plan_versions FOR SELECT TO authenticated USING (active);
CREATE POLICY "wallet prices read" ON public.wallet_price_versions FOR SELECT TO authenticated USING (active);

CREATE OR REPLACE FUNCTION public.wallet_reserve(
  p_company_id uuid,
  p_wallet_kind text,
  p_amount_cents bigint,
  p_idempotency_key text,
  p_purpose text,
  p_reference_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w company_wallets%ROWTYPE;
  r wallet_reservations%ROWTYPE;
  m bigint;
  t bigint;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_amount');
  END IF;
  SELECT * INTO r FROM wallet_reservations
    WHERE company_id = p_company_id AND wallet_kind = p_wallet_kind
      AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'reservation_id', r.id,
      'status', r.status, 'amount_cents', r.amount_cents);
  END IF;
  SELECT * INTO w FROM company_wallets
    WHERE company_id = p_company_id AND wallet_kind = p_wallet_kind FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'wallet_not_found'); END IF;
  m := LEAST(p_amount_cents, GREATEST(0, w.monthly_remaining_cents - w.reserved_monthly_cents));
  t := p_amount_cents - m;
  IF t > GREATEST(0, w.topup_balance_cents - w.reserved_topup_cents) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'insufficient_balance');
  END IF;
  INSERT INTO wallet_reservations
    (company_id, wallet_id, wallet_kind, amount_cents, monthly_cents, topup_cents,
     idempotency_key, purpose, reference_id, expires_at)
  VALUES (p_company_id, w.id, p_wallet_kind, p_amount_cents, m, t, p_idempotency_key,
    p_purpose, p_reference_id, now() + interval '10 minutes')
  RETURNING * INTO r;
  UPDATE company_wallets SET reserved_monthly_cents = reserved_monthly_cents + m,
    reserved_topup_cents = reserved_topup_cents + t, updated_at = now() WHERE id = w.id;
  INSERT INTO wallet_ledger
    (company_id, wallet_id, wallet_kind, entry_type, amount_cents, idempotency_key, reference_id, metadata)
  VALUES (p_company_id, w.id, p_wallet_kind, 'reserve', p_amount_cents, 'reserve:' || p_idempotency_key,
    p_reference_id, jsonb_build_object('monthly_cents', m, 'topup_cents', t, 'purpose', p_purpose));
  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'reservation_id', r.id,
    'status', r.status, 'amount_cents', r.amount_cents);
END $$;

CREATE OR REPLACE FUNCTION public.wallet_finish_reservation(
  p_company_id uuid, p_reservation_id uuid, p_action text, p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r wallet_reservations%ROWTYPE; w company_wallets%ROWTYPE; key text;
BEGIN
  SELECT * INTO r FROM wallet_reservations WHERE company_id = p_company_id AND id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'reservation_not_found'); END IF;
  IF r.status IN ('committed', 'released', 'expired') THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'status', r.status);
  END IF;
  SELECT * INTO w FROM company_wallets WHERE id = r.wallet_id FOR UPDATE;
  IF p_action = 'commit' THEN
    UPDATE company_wallets SET monthly_remaining_cents = monthly_remaining_cents - r.monthly_cents,
      topup_balance_cents = topup_balance_cents - r.topup_cents,
      reserved_monthly_cents = reserved_monthly_cents - r.monthly_cents,
      reserved_topup_cents = reserved_topup_cents - r.topup_cents, updated_at = now() WHERE id = w.id;
    UPDATE wallet_reservations SET status = 'committed', updated_at = now() WHERE id = r.id;
    key := 'debit:' || p_idempotency_key;
    INSERT INTO wallet_ledger (company_id, wallet_id, wallet_kind, entry_type, amount_cents, idempotency_key, reference_id)
      VALUES (p_company_id, w.id, r.wallet_kind, 'debit', -r.amount_cents, key, r.reference_id)
      ON CONFLICT (company_id, idempotency_key) DO NOTHING;
  ELSIF p_action = 'release' THEN
    UPDATE company_wallets SET reserved_monthly_cents = reserved_monthly_cents - r.monthly_cents,
      reserved_topup_cents = reserved_topup_cents - r.topup_cents, updated_at = now() WHERE id = w.id;
    UPDATE wallet_reservations SET status = 'released', updated_at = now() WHERE id = r.id;
    INSERT INTO wallet_ledger (company_id, wallet_id, wallet_kind, entry_type, amount_cents, idempotency_key, reference_id)
      VALUES (p_company_id, w.id, r.wallet_kind, 'release', r.amount_cents, 'release:' || p_idempotency_key, r.reference_id)
      ON CONFLICT (company_id, idempotency_key) DO NOTHING;
  ELSE RETURN jsonb_build_object('ok', false, 'code', 'invalid_action');
  END IF;
  RETURN jsonb_build_object('ok', true, 'idempotent', false,
    'status', CASE WHEN p_action = 'commit' THEN 'committed' ELSE 'released' END);
END $$;

CREATE OR REPLACE FUNCTION public.wallet_apply_monthly_credit(
  p_company_id uuid, p_payment_id text, p_period_start date, p_period_end date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE plan wallet_plan_versions%ROWTYPE; w company_wallets%ROWTYPE; k text;
BEGIN
  SELECT * INTO plan FROM wallet_plan_versions WHERE active ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'plan_not_found'); END IF;
  FOR w IN SELECT * FROM company_wallets WHERE company_id = p_company_id FOR UPDATE LOOP
    IF w.reserved_monthly_cents > 0 OR w.reserved_topup_cents > 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'active_reservation');
    END IF;
    UPDATE company_wallets SET monthly_credit_cents = CASE WHEN w.wallet_kind = 'ia' THEN plan.monthly_ia_credit_cents ELSE plan.monthly_whatsapp_credit_cents END,
      monthly_remaining_cents = CASE WHEN w.wallet_kind = 'ia' THEN plan.monthly_ia_credit_cents ELSE plan.monthly_whatsapp_credit_cents END,
      period_start = p_period_start, period_end = p_period_end, updated_at = now() WHERE id = w.id;
    k := 'monthly:' || p_payment_id || ':' || w.wallet_kind;
    INSERT INTO wallet_ledger (company_id, wallet_id, wallet_kind, entry_type, amount_cents, idempotency_key, reference_id, metadata)
      VALUES (p_company_id, w.id, w.wallet_kind, 'monthly_grant', CASE WHEN w.wallet_kind = 'ia' THEN plan.monthly_ia_credit_cents ELSE plan.monthly_whatsapp_credit_cents END, k, p_payment_id, jsonb_build_object('plan_version', plan.version, 'period_end', p_period_end))
      ON CONFLICT (company_id, idempotency_key) DO NOTHING;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'payment_id', p_payment_id, 'plan_version', plan.version);
END $$;

CREATE OR REPLACE FUNCTION public.wallet_apply_topup(
  p_company_id uuid, p_wallet_kind text, p_amount_cents bigint, p_payment_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w company_wallets%ROWTYPE; k text;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_amount');
  END IF;
  SELECT * INTO w FROM company_wallets WHERE company_id = p_company_id AND wallet_kind = p_wallet_kind FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'wallet_not_found'); END IF;
  k := 'topup:' || p_payment_id || ':' || p_wallet_kind;
  IF EXISTS (SELECT 1 FROM wallet_ledger WHERE company_id = p_company_id AND idempotency_key = k) THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'payment_id', p_payment_id);
  END IF;
  UPDATE company_wallets SET topup_balance_cents = topup_balance_cents + p_amount_cents, updated_at = now() WHERE id = w.id;
  INSERT INTO wallet_ledger (company_id, wallet_id, wallet_kind, entry_type, amount_cents, idempotency_key, reference_id)
    VALUES (p_company_id, w.id, p_wallet_kind, 'topup', p_amount_cents, k, p_payment_id);
  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'payment_id', p_payment_id);
END $$;

REVOKE ALL ON FUNCTION public.wallet_reserve(uuid,text,bigint,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_finish_reservation(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_apply_monthly_credit(uuid,text,date,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_apply_topup(uuid,text,bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_reserve(uuid,text,bigint,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_finish_reservation(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_apply_monthly_credit(uuid,text,date,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_apply_topup(uuid,text,bigint,text) TO service_role;
