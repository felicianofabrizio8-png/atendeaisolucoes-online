ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS goal text NOT NULL DEFAULT 'leads';

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_goal_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_goal_check
  CHECK (goal IN ('awareness','traffic','engagement','leads','sales','reactivation'));