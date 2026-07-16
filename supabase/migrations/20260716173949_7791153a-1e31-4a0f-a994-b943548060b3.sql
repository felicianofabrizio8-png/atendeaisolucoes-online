
CREATE TABLE public.marketing_knowledge_base (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_identity TEXT NOT NULL DEFAULT '',
  tone_of_voice TEXT NOT NULL DEFAULT '',
  differentiators TEXT NOT NULL DEFAULT '',
  products_services TEXT NOT NULL DEFAULT '',
  guarantees TEXT NOT NULL DEFAULT '',
  cities_served TEXT NOT NULL DEFAULT '',
  gifts TEXT NOT NULL DEFAULT '',
  commercial_terms TEXT NOT NULL DEFAULT '',
  preferred_words TEXT NOT NULL DEFAULT '',
  forbidden_words TEXT NOT NULL DEFAULT '',
  copy_best_practices TEXT NOT NULL DEFAULT '',
  extra_notes TEXT NOT NULL DEFAULT '',
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_knowledge_base TO authenticated;
GRANT ALL ON public.marketing_knowledge_base TO service_role;

ALTER TABLE public.marketing_knowledge_base ENABLE ROW LEVEL SECURITY;

CREATE POLICY mkb_select_company ON public.marketing_knowledge_base
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY mkb_insert_company ON public.marketing_knowledge_base
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY mkb_update_company ON public.marketing_knowledge_base
  FOR UPDATE TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY mkb_delete_company ON public.marketing_knowledge_base
  FOR DELETE TO authenticated
  USING (company_id = public.current_company_id());

CREATE TRIGGER trg_mkb_updated_at
  BEFORE UPDATE ON public.marketing_knowledge_base
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
