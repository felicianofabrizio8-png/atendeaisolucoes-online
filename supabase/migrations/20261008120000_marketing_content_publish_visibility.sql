ALTER TABLE public.marketing_contents
  ADD COLUMN IF NOT EXISTS hidden_from_publish boolean NOT NULL DEFAULT false;
