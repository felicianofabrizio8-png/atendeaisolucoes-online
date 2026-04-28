CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  numero text NOT NULL,
  mensagem text NOT NULL,
  direction text NOT NULL DEFAULT 'in' CHECK (direction IN ('in','out')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wa_messages_company_numero_created
  ON public.whatsapp_messages (company_id, numero, created_at DESC);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company select wa msgs"
  ON public.whatsapp_messages FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "company insert wa msgs"
  ON public.whatsapp_messages FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "company update wa msgs"
  ON public.whatsapp_messages FOR UPDATE TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "company delete wa msgs"
  ON public.whatsapp_messages FOR DELETE TO authenticated
  USING (company_id = public.current_company_id());

ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
ALTER TABLE public.whatsapp_messages REPLICA IDENTITY FULL;