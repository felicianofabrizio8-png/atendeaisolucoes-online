ALTER TABLE public.conversation_sales_states
  ADD COLUMN IF NOT EXISTS last_catalog_query jsonb;

COMMENT ON COLUMN public.conversation_sales_states.last_catalog_query IS
  'Structured user criteria, catalog search state, and product ID references; never product facts.';
