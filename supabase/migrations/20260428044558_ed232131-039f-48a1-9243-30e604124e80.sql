ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS whatsapp_jid text,
  ADD COLUMN IF NOT EXISTS push_name text;

CREATE INDEX IF NOT EXISTS whatsapp_messages_jid_idx
  ON public.whatsapp_messages (company_id, whatsapp_jid);

CREATE INDEX IF NOT EXISTS whatsapp_messages_numero_idx
  ON public.whatsapp_messages (company_id, numero);