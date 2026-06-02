-- Beta flag para liberar publicação real no Meta Ads de forma controlada
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS meta_campaigns_beta boolean NOT NULL DEFAULT false;

-- Garante que status do campaign aceita 'publishing' e 'failed' (já é text, sem CHECK)
-- Apenas documentação: status válidos UI = draft|publishing|active|paused|ended|failed|rejected

-- Index leve para queries de campanhas por status meta
CREATE INDEX IF NOT EXISTS idx_campaigns_meta_sync_status
  ON public.campaigns(meta_sync_status)
  WHERE meta_sync_status <> 'pending';