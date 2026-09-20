ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS sales_agent_v2_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sales_agent_v2_mode text NOT NULL DEFAULT 'assisted';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.company_settings'::regclass
      AND conname = 'company_settings_sales_agent_v2_mode_check'
  ) THEN
    ALTER TABLE public.company_settings
      ADD CONSTRAINT company_settings_sales_agent_v2_mode_check
      CHECK (sales_agent_v2_mode IN ('silent', 'assisted', 'automatic'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.company_settings.sales_agent_v2_enabled IS
  'Opt-in da Vendedora 2.0; false preserva o fluxo legado.';
COMMENT ON COLUMN public.company_settings.sales_agent_v2_mode IS
  'Modo efetivo: silent, assisted ou automatic.';
