GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_replies TO authenticated;
GRANT ALL ON public.quick_replies TO service_role;

ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company select quick_replies" ON public.quick_replies;
DROP POLICY IF EXISTS "company insert quick_replies" ON public.quick_replies;
DROP POLICY IF EXISTS "company update quick_replies" ON public.quick_replies;
DROP POLICY IF EXISTS "company delete quick_replies" ON public.quick_replies;

CREATE POLICY "company select quick_replies" ON public.quick_replies
  FOR SELECT TO authenticated
  USING (company_id = private.current_company_id());

CREATE POLICY "company insert quick_replies" ON public.quick_replies
  FOR INSERT TO authenticated
  WITH CHECK (company_id = private.current_company_id());

CREATE POLICY "company update quick_replies" ON public.quick_replies
  FOR UPDATE TO authenticated
  USING (company_id = private.current_company_id())
  WITH CHECK (company_id = private.current_company_id());

CREATE POLICY "company delete quick_replies" ON public.quick_replies
  FOR DELETE TO authenticated
  USING (company_id = private.current_company_id());