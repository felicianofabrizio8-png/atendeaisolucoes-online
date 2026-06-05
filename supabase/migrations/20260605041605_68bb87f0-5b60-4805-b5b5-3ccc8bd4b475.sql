CREATE TABLE public.quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  icon text,
  category text,
  content text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_replies TO authenticated;
GRANT ALL ON public.quick_replies TO service_role;

ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company select quick_replies" ON public.quick_replies
  FOR SELECT TO authenticated USING (company_id = private.current_company_id());
CREATE POLICY "company insert quick_replies" ON public.quick_replies
  FOR INSERT TO authenticated WITH CHECK (company_id = private.current_company_id());
CREATE POLICY "company update quick_replies" ON public.quick_replies
  FOR UPDATE TO authenticated USING (company_id = private.current_company_id());
CREATE POLICY "company delete quick_replies" ON public.quick_replies
  FOR DELETE TO authenticated USING (company_id = private.current_company_id());

CREATE TRIGGER set_quick_replies_updated_at
  BEFORE UPDATE ON public.quick_replies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_quick_replies_company_sort ON public.quick_replies(company_id, sort_order);