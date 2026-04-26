-- Channel integrations (WhatsApp, Instagram, Facebook)
CREATE TABLE IF NOT EXISTS public.integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  channel public.channel NOT NULL,
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  -- Identificador externo (ex: phone_number_id do WhatsApp, page_id do FB, ig_user_id)
  external_account_id text,
  -- Metadados públicos não sensíveis (número, nome, etc.)
  account_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Credenciais sensíveis (token de acesso da API, app_secret, etc.)
  access_token text,
  webhook_secret text,
  verify_token text,
  -- Status de saúde da conexão
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS integrations_company_channel_external_uniq
  ON public.integrations (company_id, channel, COALESCE(external_account_id, ''));

CREATE INDEX IF NOT EXISTS integrations_company_idx
  ON public.integrations (company_id);

CREATE INDEX IF NOT EXISTS integrations_channel_external_idx
  ON public.integrations (channel, external_account_id);

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company select integrations" ON public.integrations
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "company insert integrations" ON public.integrations
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "company update integrations" ON public.integrations
  FOR UPDATE TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "company delete integrations" ON public.integrations
  FOR DELETE TO authenticated
  USING (company_id = public.current_company_id());

DROP TRIGGER IF EXISTS set_integrations_updated_at ON public.integrations;
CREATE TRIGGER set_integrations_updated_at
  BEFORE UPDATE ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- External IDs to correlate with provider events / dedupe webhooks
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS integration_id uuid REFERENCES public.integrations(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS messages_external_uniq
  ON public.messages (integration_id, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS integration_id uuid REFERENCES public.integrations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS leads_integration_external_idx
  ON public.leads (integration_id, external_id);

-- Realtime
ALTER TABLE public.integrations REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.integrations;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;