ALTER TABLE public.marketing_contents
  ADD COLUMN IF NOT EXISTS video_layout jsonb,
  ADD COLUMN IF NOT EXISTS video_template text;