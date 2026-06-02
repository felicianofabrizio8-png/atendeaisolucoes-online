-- =============================
-- Meta Sync infrastructure (prep only — no automatic sync yet)
-- =============================

-- 1. Extend campaigns with Meta sync metadata
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS meta_adset_id text,
  ADD COLUMN IF NOT EXISTS meta_ad_id text,
  ADD COLUMN IF NOT EXISTS meta_sync_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS meta_last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS meta_publish_error text,
  ADD COLUMN IF NOT EXISTS meta_delivery_status text;

-- Constrain meta_sync_status to known states
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_meta_sync_status_check'
  ) THEN
    ALTER TABLE public.campaigns
      ADD CONSTRAINT campaigns_meta_sync_status_check
      CHECK (meta_sync_status IN ('pending','syncing','active','paused','rejected','failed','archived'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_campaigns_meta_sync_status
  ON public.campaigns(company_id, meta_sync_status);

-- 2. Campaign metrics table (real Meta Ads numbers — empty for now)
CREATE TABLE IF NOT EXISTS public.campaign_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  impressions bigint NOT NULL DEFAULT 0,
  reach bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  ctr numeric(8,4) NOT NULL DEFAULT 0,
  cpc numeric(12,4) NOT NULL DEFAULT 0,
  cpm numeric(12,4) NOT NULL DEFAULT 0,
  spent numeric(14,2) NOT NULL DEFAULT 0,
  messages bigint NOT NULL DEFAULT 0,
  leads bigint NOT NULL DEFAULT 0,
  metric_date date,
  source text NOT NULL DEFAULT 'meta',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_metrics_campaign
  ON public.campaign_metrics(campaign_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_metrics_company
  ON public.campaign_metrics(company_id, created_at DESC);

-- GRANTs — auth-only table scoped via current_company_id()
GRANT SELECT ON public.campaign_metrics TO authenticated;
GRANT ALL ON public.campaign_metrics TO service_role;

-- RLS
ALTER TABLE public.campaign_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company select campaign_metrics"
  ON public.campaign_metrics
  FOR SELECT
  TO authenticated
  USING (company_id = private.current_company_id());

-- Inserts/updates/deletes intentionally NOT granted to authenticated:
-- only the future Meta sync job (running with service_role) writes here.

-- Trigger to keep updated_at fresh
DROP TRIGGER IF EXISTS trg_campaign_metrics_updated_at ON public.campaign_metrics;
CREATE TRIGGER trg_campaign_metrics_updated_at
  BEFORE UPDATE ON public.campaign_metrics
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
