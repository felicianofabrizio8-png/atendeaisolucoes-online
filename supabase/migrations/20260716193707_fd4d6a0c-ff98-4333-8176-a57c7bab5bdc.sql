
CREATE TABLE public.marketing_campaign_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  promotion_id uuid REFERENCES public.marketing_promotions(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  strategy_id text NOT NULL,
  objective text,
  audience text,
  tone text,
  strategy jsonb NOT NULL DEFAULT '{}'::jsonb,
  story_title text,
  story_body text,
  feed_title text,
  feed_body text,
  reel_title text,
  reel_body text,
  whatsapp_title text,
  whatsapp_body text,
  media_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  kb_version text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX marketing_campaign_memory_company_created_idx
  ON public.marketing_campaign_memory (company_id, created_at DESC);
CREATE INDEX marketing_campaign_memory_company_product_idx
  ON public.marketing_campaign_memory (company_id, product_id);
CREATE INDEX marketing_campaign_memory_company_promotion_idx
  ON public.marketing_campaign_memory (company_id, promotion_id);
CREATE INDEX marketing_campaign_memory_company_strategy_idx
  ON public.marketing_campaign_memory (company_id, strategy_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_campaign_memory TO authenticated;
GRANT ALL ON public.marketing_campaign_memory TO service_role;

ALTER TABLE public.marketing_campaign_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaign_memory_select_own"
  ON public.marketing_campaign_memory
  FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "campaign_memory_insert_own"
  ON public.marketing_campaign_memory
  FOR INSERT
  TO authenticated
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "campaign_memory_update_own"
  ON public.marketing_campaign_memory
  FOR UPDATE
  TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "campaign_memory_delete_own"
  ON public.marketing_campaign_memory
  FOR DELETE
  TO authenticated
  USING (company_id = public.current_company_id());
