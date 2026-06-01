-- Modo piloto da IA: controle por empresa
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS ai_pilot_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_pilot_enabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_last_test_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_last_test_result jsonb;

CREATE INDEX IF NOT EXISTS idx_company_settings_pilot ON public.company_settings(ai_pilot_mode) WHERE ai_pilot_mode = true;
CREATE INDEX IF NOT EXISTS idx_ai_flow_events_company_created ON public.ai_flow_events(company_id, created_at DESC);