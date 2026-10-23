-- Política de desconto da Vendedora IA, definida só pelo lojista, por empresa.
-- Padrão: nenhum desconto. Textos livres de políticas comerciais existentes não
-- são alterados nem convertidos: desconto só passa a valer quando o lojista o
-- cadastra aqui.

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS ai_discount_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS ai_discount_rules jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Regras: até 10 itens {percent: número em (0, 100], condition: texto não vazio}.
CREATE OR REPLACE FUNCTION public.is_valid_discount_rules(rules jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_typeof(rules) = 'array'
    AND jsonb_array_length(rules) <= 10
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(rules) AS rule
      WHERE CASE
        WHEN jsonb_typeof(rule) <> 'object' THEN true
        WHEN jsonb_typeof(rule -> 'percent') IS DISTINCT FROM 'number' THEN true
        WHEN jsonb_typeof(rule -> 'condition') IS DISTINCT FROM 'string' THEN true
        ELSE (rule ->> 'percent')::numeric <= 0
          OR (rule ->> 'percent')::numeric > 100
          OR length(btrim(rule ->> 'condition')) = 0
          OR length(rule ->> 'condition') > 160
      END
    );
$$;

ALTER TABLE public.company_settings
  DROP CONSTRAINT IF EXISTS company_settings_ai_discount_mode_check,
  ADD CONSTRAINT company_settings_ai_discount_mode_check
    CHECK (ai_discount_mode IN ('none', 'authorized', 'approval_required')),
  DROP CONSTRAINT IF EXISTS company_settings_ai_discount_rules_check,
  ADD CONSTRAINT company_settings_ai_discount_rules_check
    CHECK (public.is_valid_discount_rules(ai_discount_rules));

COMMENT ON COLUMN public.company_settings.ai_discount_mode IS
  'Política de desconto da Vendedora IA: none (nenhum), authorized (só ai_discount_rules) ou approval_required (pedido vai para humano).';
COMMENT ON COLUMN public.company_settings.ai_discount_rules IS
  'Descontos autorizados pelo lojista: [{percent, condition}]. Só vale com ai_discount_mode = authorized.';
