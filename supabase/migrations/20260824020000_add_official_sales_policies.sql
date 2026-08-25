-- Políticas oficiais da empresa consumidas pelo SalesAgent.
-- Migração aditiva: não preenche, copia ou infere conteúdo existente.
ALTER TABLE public.marketing_knowledge_base
  ADD COLUMN IF NOT EXISTS payment_policy text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS installation_policy text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS visit_policy text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS heating_policy text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS shipping_policy text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS included_items_policy text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.marketing_knowledge_base.payment_policy IS
  'Política oficial geral de pagamento; fatos e preços de produtos permanecem no catálogo.';
COMMENT ON COLUMN public.marketing_knowledge_base.installation_policy IS
  'Política oficial geral de instalação.';
COMMENT ON COLUMN public.marketing_knowledge_base.visit_policy IS
  'Política oficial geral para visitas técnicas ou comerciais.';
COMMENT ON COLUMN public.marketing_knowledge_base.heating_policy IS
  'Política oficial geral de aquecimento; compatibilidade específica permanece em products.';
COMMENT ON COLUMN public.marketing_knowledge_base.shipping_policy IS
  'Política oficial geral de frete e entrega.';
COMMENT ON COLUMN public.marketing_knowledge_base.included_items_policy IS
  'Política oficial geral de itens inclusos; composição específica permanece em products.included_items.';
