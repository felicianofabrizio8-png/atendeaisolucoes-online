CREATE TABLE public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  integration_id uuid,
  meta_template_id text,
  name text NOT NULL,
  language text NOT NULL DEFAULT 'pt_BR',
  category text NOT NULL CHECK (category IN ('utility','marketing','authentication')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('approved','pending','rejected','paused','disabled','in_appeal','pending_deletion')),
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  purpose text CHECK (purpose IS NULL OR purpose IN ('quote_no_reply','lead_silent','visit_no_return','hot_lead_idle','returning_customer','appointment_confirmation','conversation_resume')),
  auto_use boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz,
  meta_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name, language)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_templates TO authenticated;
GRANT ALL ON public.whatsapp_templates TO service_role;

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company select wa_templates" ON public.whatsapp_templates
  FOR SELECT TO authenticated USING (company_id = private.current_company_id());
CREATE POLICY "company insert wa_templates" ON public.whatsapp_templates
  FOR INSERT TO authenticated WITH CHECK (company_id = private.current_company_id());
CREATE POLICY "company update wa_templates" ON public.whatsapp_templates
  FOR UPDATE TO authenticated USING (company_id = private.current_company_id());
CREATE POLICY "company delete wa_templates" ON public.whatsapp_templates
  FOR DELETE TO authenticated USING (company_id = private.current_company_id());

CREATE TRIGGER set_wa_templates_updated_at
  BEFORE UPDATE ON public.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_wa_templates_company_purpose ON public.whatsapp_templates (company_id, purpose, status) WHERE auto_use = true;
CREATE INDEX idx_wa_templates_company_status ON public.whatsapp_templates (company_id, status);