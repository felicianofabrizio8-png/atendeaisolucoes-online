CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid()
$$;

GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_company_id() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.current_company_id() FROM anon, authenticated, PUBLIC;

DROP POLICY IF EXISTS "members read company" ON public.companies;
CREATE POLICY "members read company" ON public.companies FOR SELECT TO authenticated USING (id = private.current_company_id());
DROP POLICY IF EXISTS "members update company" ON public.companies;
CREATE POLICY "members update company" ON public.companies FOR UPDATE TO authenticated USING (id = private.current_company_id());

DROP POLICY IF EXISTS "company select settings" ON public.company_settings;
CREATE POLICY "company select settings" ON public.company_settings FOR SELECT TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company insert settings" ON public.company_settings;
CREATE POLICY "company insert settings" ON public.company_settings FOR INSERT TO authenticated WITH CHECK (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company update settings" ON public.company_settings;
CREATE POLICY "company update settings" ON public.company_settings FOR UPDATE TO authenticated USING (company_id = private.current_company_id());

DROP POLICY IF EXISTS "company select conv" ON public.conversations;
CREATE POLICY "company select conv" ON public.conversations FOR SELECT TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company insert conv" ON public.conversations;
CREATE POLICY "company insert conv" ON public.conversations FOR INSERT TO authenticated WITH CHECK (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company update conv" ON public.conversations;
CREATE POLICY "company update conv" ON public.conversations FOR UPDATE TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company delete conv" ON public.conversations;
CREATE POLICY "company delete conv" ON public.conversations FOR DELETE TO authenticated USING (company_id = private.current_company_id());

DROP POLICY IF EXISTS "company select integrations" ON public.integrations;
CREATE POLICY "company select integrations" ON public.integrations FOR SELECT TO authenticated USING (company_id = private.current_company_id());

DROP POLICY IF EXISTS "company select leads" ON public.leads;
CREATE POLICY "company select leads" ON public.leads FOR SELECT TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company insert leads" ON public.leads;
CREATE POLICY "company insert leads" ON public.leads FOR INSERT TO authenticated WITH CHECK (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company update leads" ON public.leads;
CREATE POLICY "company update leads" ON public.leads FOR UPDATE TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company delete leads" ON public.leads;
CREATE POLICY "company delete leads" ON public.leads FOR DELETE TO authenticated USING (company_id = private.current_company_id());

DROP POLICY IF EXISTS "company select reasons" ON public.loss_reasons;
CREATE POLICY "company select reasons" ON public.loss_reasons FOR SELECT TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company insert reasons" ON public.loss_reasons;
CREATE POLICY "company insert reasons" ON public.loss_reasons FOR INSERT TO authenticated WITH CHECK (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company update reasons" ON public.loss_reasons;
CREATE POLICY "company update reasons" ON public.loss_reasons FOR UPDATE TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company delete reasons" ON public.loss_reasons;
CREATE POLICY "company delete reasons" ON public.loss_reasons FOR DELETE TO authenticated USING (company_id = private.current_company_id());

DROP POLICY IF EXISTS "company select msg" ON public.messages;
CREATE POLICY "company select msg" ON public.messages FOR SELECT TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company insert msg" ON public.messages;
CREATE POLICY "company insert msg" ON public.messages FOR INSERT TO authenticated WITH CHECK (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company update msg" ON public.messages;
CREATE POLICY "company update msg" ON public.messages FOR UPDATE TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company delete msg" ON public.messages;
CREATE POLICY "company delete msg" ON public.messages FOR DELETE TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company members can receive realtime" ON public.messages;
CREATE POLICY "company members can receive realtime" ON public.messages FOR SELECT TO authenticated USING (realtime.topic() = ('inbox-'::text || private.current_company_id()::text));

DROP POLICY IF EXISTS "company select meta_pages safe" ON public.meta_pages;
CREATE POLICY "company select meta_pages safe" ON public.meta_pages FOR SELECT TO authenticated USING (company_id = private.current_company_id());

DROP POLICY IF EXISTS "company select products" ON public.products;
CREATE POLICY "company select products" ON public.products FOR SELECT TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company insert products" ON public.products;
CREATE POLICY "company insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company update products" ON public.products;
CREATE POLICY "company update products" ON public.products FOR UPDATE TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company delete products" ON public.products;
CREATE POLICY "company delete products" ON public.products FOR DELETE TO authenticated USING (company_id = private.current_company_id());

DROP POLICY IF EXISTS "read company profiles" ON public.profiles;
CREATE POLICY "read company profiles" ON public.profiles FOR SELECT TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "update own profile" ON public.profiles;
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK ((id = auth.uid()) AND (company_id = private.current_company_id()));

DROP POLICY IF EXISTS "company select quotes" ON public.quotes;
CREATE POLICY "company select quotes" ON public.quotes FOR SELECT TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company insert quotes" ON public.quotes;
CREATE POLICY "company insert quotes" ON public.quotes FOR INSERT TO authenticated WITH CHECK (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company update quotes" ON public.quotes;
CREATE POLICY "company update quotes" ON public.quotes FOR UPDATE TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company delete quotes" ON public.quotes;
CREATE POLICY "company delete quotes" ON public.quotes FOR DELETE TO authenticated USING (company_id = private.current_company_id());

DROP POLICY IF EXISTS "company select visits" ON public.visits;
CREATE POLICY "company select visits" ON public.visits FOR SELECT TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company insert visits" ON public.visits;
CREATE POLICY "company insert visits" ON public.visits FOR INSERT TO authenticated WITH CHECK (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company update visits" ON public.visits;
CREATE POLICY "company update visits" ON public.visits FOR UPDATE TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company delete visits" ON public.visits;
CREATE POLICY "company delete visits" ON public.visits FOR DELETE TO authenticated USING (company_id = private.current_company_id());

DROP POLICY IF EXISTS "company select wa msgs" ON public.whatsapp_messages;
CREATE POLICY "company select wa msgs" ON public.whatsapp_messages FOR SELECT TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company insert wa msgs" ON public.whatsapp_messages;
CREATE POLICY "company insert wa msgs" ON public.whatsapp_messages FOR INSERT TO authenticated WITH CHECK (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company update wa msgs" ON public.whatsapp_messages;
CREATE POLICY "company update wa msgs" ON public.whatsapp_messages FOR UPDATE TO authenticated USING (company_id = private.current_company_id());
DROP POLICY IF EXISTS "company delete wa msgs" ON public.whatsapp_messages;
CREATE POLICY "company delete wa msgs" ON public.whatsapp_messages FOR DELETE TO authenticated USING (company_id = private.current_company_id());