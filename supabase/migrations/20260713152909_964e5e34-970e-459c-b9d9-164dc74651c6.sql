
-- company_onboarding: per-company onboarding progress
CREATE TYPE public.onboarding_status AS ENUM ('pending','in_progress','completed','paused');

CREATE TABLE public.company_onboarding (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  current_step TEXT NOT NULL DEFAULT 'company_created',
  completed_steps_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status public.onboarding_status NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_onboarding_company ON public.company_onboarding(company_id);
CREATE INDEX idx_company_onboarding_status ON public.company_onboarding(status);

GRANT SELECT ON public.company_onboarding TO authenticated;
GRANT ALL ON public.company_onboarding TO service_role;

ALTER TABLE public.company_onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read own company onboarding"
  ON public.company_onboarding FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), company_id, 'admin'::app_role));

CREATE TRIGGER trg_company_onboarding_updated
  BEFORE UPDATE ON public.company_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- company_onboarding_events: append-only timeline (no PII)
CREATE TABLE public.company_onboarding_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_onboarding_events_company ON public.company_onboarding_events(company_id, created_at DESC);

GRANT SELECT ON public.company_onboarding_events TO authenticated;
GRANT ALL ON public.company_onboarding_events TO service_role;

ALTER TABLE public.company_onboarding_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read own company onboarding events"
  ON public.company_onboarding_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), company_id, 'admin'::app_role));
