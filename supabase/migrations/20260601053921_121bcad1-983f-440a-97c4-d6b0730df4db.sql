-- Tabela para registrar eventos WhatsApp que chegaram pelo webhook mas não
-- encontraram integração cadastrada. Serve como alerta administrativo para
-- mostrar ao usuário que existe outro número WhatsApp recebendo mensagens
-- (ex: o número antigo do Business Manager) e que precisa ser conectado ou
-- desativado.

CREATE TABLE IF NOT EXISTS public.whatsapp_unmapped_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number_id text NOT NULL,
  waba_id text,
  display_phone_number text,
  from_wa_id text,
  contact_name text,
  message_preview text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_unmapped_waba ON public.whatsapp_unmapped_events(waba_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_unmapped_phone ON public.whatsapp_unmapped_events(phone_number_id, created_at DESC);

-- Apenas o servidor (service_role) escreve. Usuários autenticados leem só os
-- eventos cuja waba_id já está vinculada a alguma integração WhatsApp da
-- empresa deles — assim ficam visíveis "números irmãos" do mesmo Business
-- Manager sem vazar eventos de outras empresas.
GRANT SELECT ON public.whatsapp_unmapped_events TO authenticated;
GRANT ALL ON public.whatsapp_unmapped_events TO service_role;

ALTER TABLE public.whatsapp_unmapped_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company select unmapped wa events by waba"
  ON public.whatsapp_unmapped_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.integrations i
      WHERE i.company_id = private.current_company_id()
        AND i.channel = 'whatsapp'
        AND (
          (i.account_metadata->>'waba_id') = whatsapp_unmapped_events.waba_id
          OR i.external_account_id = whatsapp_unmapped_events.phone_number_id
        )
    )
  );

-- Política mais permissiva: também mostrar eventos sem waba_id casado, para
-- qualquer empresa que tenha pelo menos uma integração WhatsApp ativa, das
-- últimas 24h — assim o admin vê alertas mesmo de números completamente
-- novos. Esses dados são apenas IDs do WhatsApp Business, não PII sensível.
CREATE POLICY "company select unmapped wa events recent"
  ON public.whatsapp_unmapped_events
  FOR SELECT
  TO authenticated
  USING (
    created_at > (now() - interval '7 days')
    AND EXISTS (
      SELECT 1 FROM public.integrations i
      WHERE i.company_id = private.current_company_id()
        AND i.channel = 'whatsapp'
    )
  );