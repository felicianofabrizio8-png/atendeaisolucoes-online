
-- Fase 2 do Agente IA: qualificação inteligente de leads
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS detected_state text,
  ADD COLUMN IF NOT EXISTS detected_interest text,
  ADD COLUMN IF NOT EXISTS detected_budget text,
  ADD COLUMN IF NOT EXISTS purchase_timing text,
  ADD COLUMN IF NOT EXISTS lead_temperature text,
  ADD COLUMN IF NOT EXISTS lead_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_ready_to_close boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS detected_objections text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS customer_stage text;

-- Constraints leves (texto controlado, mas evita CHECK rígido para suportar evolução)
COMMENT ON COLUMN public.conversations.lead_temperature IS 'frio | morno | quente';
COMMENT ON COLUMN public.conversations.customer_stage IS 'curioso | pesquisando | pronto_para_comprar';
COMMENT ON COLUMN public.conversations.purchase_timing IS 'imediato | 30d | 60d | 90d+ | indefinido';
COMMENT ON COLUMN public.conversations.detected_objections IS 'preco | prazo | concorrencia | financiamento | espaco | confianca';

-- Índices para os novos filtros do inbox
CREATE INDEX IF NOT EXISTS conversations_lead_temperature_idx
  ON public.conversations (company_id, lead_temperature)
  WHERE lead_temperature IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversations_ai_status_idx
  ON public.conversations (company_id, ai_status)
  WHERE ai_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversations_ready_close_idx
  ON public.conversations (company_id)
  WHERE lead_ready_to_close = true;
