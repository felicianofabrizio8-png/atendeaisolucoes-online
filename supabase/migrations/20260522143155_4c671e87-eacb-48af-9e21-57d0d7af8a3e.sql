
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;

CREATE TABLE IF NOT EXISTS public.meta_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  integration_id uuid,
  page_id text NOT NULL,
  page_name text NOT NULL,
  ig_business_account_id text,
  ig_username text,
  page_access_token text NOT NULL,
  token_expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, page_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_pages_page_id ON public.meta_pages(page_id);
CREATE INDEX IF NOT EXISTS idx_meta_pages_ig ON public.meta_pages(ig_business_account_id);

ALTER TABLE public.meta_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny all client access to meta_pages"
ON public.meta_pages FOR ALL TO anon, authenticated
USING (false) WITH CHECK (false);

CREATE POLICY "company select meta_pages safe"
ON public.meta_pages FOR SELECT TO authenticated
USING (company_id = current_company_id());

CREATE TRIGGER trg_meta_pages_updated_at
BEFORE UPDATE ON public.meta_pages
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS source_sender_id text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS source_page_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_source_unique
  ON public.leads(company_id, source, source_sender_id)
  WHERE source IS NOT NULL AND source_sender_id IS NOT NULL;

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS source_subtype text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
