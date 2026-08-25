CREATE TABLE IF NOT EXISTS public.conversation_sales_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('training_session', 'whatsapp_conversation')),
  scope_id uuid NOT NULL,
  product_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  intent text,
  last_valid_product_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, scope_type, scope_id),
  CHECK (jsonb_typeof(attributes) = 'object')
);

CREATE INDEX IF NOT EXISTS conversation_sales_states_scope_idx
  ON public.conversation_sales_states (company_id, scope_type, scope_id);

ALTER TABLE public.conversation_sales_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_sales_states_company_access
  ON public.conversation_sales_states;
CREATE POLICY conversation_sales_states_company_access
  ON public.conversation_sales_states
  FOR ALL
  TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.conversation_sales_states TO authenticated;
GRANT ALL ON public.conversation_sales_states TO service_role;
