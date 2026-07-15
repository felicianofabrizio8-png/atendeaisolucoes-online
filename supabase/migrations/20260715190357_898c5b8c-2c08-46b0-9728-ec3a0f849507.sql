
-- 1) companies.environment
ALTER TABLE public.companies
  ADD COLUMN environment TEXT NOT NULL DEFAULT 'production'
  CHECK (environment IN ('production','staging'));

CREATE INDEX IF NOT EXISTS idx_companies_staging
  ON public.companies(id) WHERE environment = 'staging';

-- 2) environment_simulations
CREATE TABLE public.environment_simulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_id TEXT,
  action TEXT NOT NULL,
  target_url TEXT,
  method TEXT,
  payload_sanitized JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL,
  simulated_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.environment_simulations TO authenticated;
GRANT ALL    ON public.environment_simulations TO service_role;

ALTER TABLE public.environment_simulations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own company simulations"
  ON public.environment_simulations FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

CREATE INDEX idx_env_sim_company_created
  ON public.environment_simulations(company_id, created_at DESC);

CREATE INDEX idx_env_sim_action
  ON public.environment_simulations(action, created_at DESC);

-- 3) runtime_config (kill switch)
CREATE TABLE public.runtime_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT ON public.runtime_config TO authenticated;
GRANT ALL    ON public.runtime_config TO service_role;

ALTER TABLE public.runtime_config ENABLE ROW LEVEL SECURITY;

-- Leitura permitida para admins da empresa corrente (usa has_role já existente,
-- que tem assinatura _user_id/_company_id/_role neste projeto).
CREATE POLICY "runtime_config read for admins"
  ON public.runtime_config FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), public.current_company_id(), 'admin'::app_role));

-- Writes só via service_role (nenhuma policy para authenticated).

INSERT INTO public.runtime_config (key, value)
VALUES ('environment_guard_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 4) prevent_environment_flip — só service_role pode alterar environment
CREATE OR REPLACE FUNCTION public.prevent_environment_flip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF NEW.environment IS DISTINCT FROM OLD.environment THEN
    v_role := current_setting('request.jwt.claim.role', true);
    IF v_role IS NULL OR v_role <> 'service_role' THEN
      RAISE EXCEPTION 'environment change requires service_role (got %)', COALESCE(v_role, 'null');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_env_flip
  BEFORE UPDATE OF environment ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.prevent_environment_flip();

-- 5) prevent_staging_real_integration
CREATE OR REPLACE FUNCTION public.prevent_staging_real_integration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_env text;
BEGIN
  SELECT environment INTO v_env FROM public.companies WHERE id = NEW.company_id;
  IF v_env = 'staging'
     AND COALESCE(NEW.active, false) = true
     AND NEW.access_token IS NOT NULL
     AND length(trim(NEW.access_token)) > 0
     AND NEW.access_token NOT LIKE 'sim\_%' ESCAPE '\' THEN
    RAISE EXCEPTION 'staging_tenant_cannot_activate_real_integration';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_staging_real_integration
  BEFORE INSERT OR UPDATE ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_staging_real_integration();

-- 6) prevent_staging_campaign_publish
CREATE OR REPLACE FUNCTION public.prevent_staging_campaign_publish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_env text;
BEGIN
  SELECT environment INTO v_env FROM public.companies WHERE id = NEW.company_id;
  IF v_env = 'staging' AND NEW.meta_delivery_status = 'active_on_meta' THEN
    RAISE EXCEPTION 'staging_tenant_cannot_publish_campaign';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_staging_campaign_publish
  BEFORE INSERT OR UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.prevent_staging_campaign_publish();
