CREATE INDEX IF NOT EXISTS idx_messages_company_conv_at_desc
  ON public.messages (company_id, conversation_id, at DESC);