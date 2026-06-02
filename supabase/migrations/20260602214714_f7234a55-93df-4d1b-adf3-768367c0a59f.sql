ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS default_quote_included_items text,
  ADD COLUMN IF NOT EXISTS default_quote_gifts text,
  ADD COLUMN IF NOT EXISTS default_quote_customer_responsibility text;