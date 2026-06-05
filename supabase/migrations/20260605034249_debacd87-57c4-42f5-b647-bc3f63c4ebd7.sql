
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS deleted_by uuid;

DROP POLICY IF EXISTS "company update msg" ON public.messages;
CREATE POLICY "company update msg"
ON public.messages
FOR UPDATE
TO authenticated
USING (company_id = private.current_company_id() AND role = 'agent')
WITH CHECK (company_id = private.current_company_id() AND role = 'agent');
