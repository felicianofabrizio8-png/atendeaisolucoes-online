-- Previsão operacional da próxima carga, usada como contexto da IA.
ALTER TABLE public.marketing_knowledge_base
  ADD COLUMN IF NOT EXISTS next_load_forecast text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.marketing_knowledge_base.next_load_forecast IS
  'Previsão da próxima carga; informar apenas quando o cliente perguntar sobre prazo, entrega ou instalação, sem prometer data.';
