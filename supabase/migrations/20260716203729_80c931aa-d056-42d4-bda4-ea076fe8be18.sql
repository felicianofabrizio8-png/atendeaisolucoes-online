
-- Marketing Publisher — Phase 2
-- Aditivo. Nada existente é alterado.

-- 1) Estende enum de status do calendário para refletir estado pós-execução.
ALTER TYPE public.marketing_schedule_status ADD VALUE IF NOT EXISTS 'queued';
ALTER TYPE public.marketing_schedule_status ADD VALUE IF NOT EXISTS 'publishing';
ALTER TYPE public.marketing_schedule_status ADD VALUE IF NOT EXISTS 'failed';

-- 2) Tabela de publicações.
CREATE TABLE public.marketing_publications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  schedule_id        uuid NOT NULL UNIQUE REFERENCES public.marketing_schedule(id) ON DELETE CASCADE,
  content_id         uuid NOT NULL REFERENCES public.marketing_contents(id) ON DELETE CASCADE,
  channel            text NOT NULL CHECK (channel IN ('instagram','facebook')),
  format             text NOT NULL CHECK (format IN ('feed','reel','story')),
  status             text NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','publishing','published','failed','cancelled')),
  platform_post_id   text,
  platform_response  jsonb,
  error_code         text,
  error_message      text,
  retry_count        int  NOT NULL DEFAULT 0,
  attempt_log        jsonb NOT NULL DEFAULT '[]'::jsonb,
  locked_by          text,
  locked_at          timestamptz,
  available_at       timestamptz NOT NULL DEFAULT now(),
  published_at       timestamptz,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mp_status_available ON public.marketing_publications (status, available_at);
CREATE INDEX idx_mp_company_created  ON public.marketing_publications (company_id, created_at DESC);
CREATE INDEX idx_mp_schedule         ON public.marketing_publications (schedule_id);

-- 3) GRANTs (SELECT via RLS para authenticated; writes só service_role via worker).
GRANT SELECT ON public.marketing_publications TO authenticated;
GRANT ALL    ON public.marketing_publications TO service_role;

-- 4) RLS
ALTER TABLE public.marketing_publications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mp_select_company"
  ON public.marketing_publications
  FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

-- Sem policies de INSERT/UPDATE/DELETE para authenticated: worker usa service_role.

-- 5) Trigger updated_at
CREATE TRIGGER trg_mp_updated_at
  BEFORE UPDATE ON public.marketing_publications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
