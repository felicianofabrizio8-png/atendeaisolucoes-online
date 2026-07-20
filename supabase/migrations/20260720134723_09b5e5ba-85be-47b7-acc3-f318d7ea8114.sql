ALTER TABLE public.marketing_contents
  ADD COLUMN IF NOT EXISTS overlay_original_headline text,
  ADD COLUMN IF NOT EXISTS overlay_original_subheadline text,
  ADD COLUMN IF NOT EXISTS overlay_original_cta text,
  ADD COLUMN IF NOT EXISTS overlay_approved_at timestamptz;

COMMENT ON COLUMN public.marketing_contents.overlay_original_headline IS
  'Snapshot do headline sugerido pela IA na primeira geração — usado para restaurar.';
COMMENT ON COLUMN public.marketing_contents.overlay_original_subheadline IS
  'Snapshot do subheadline sugerido pela IA na primeira geração — usado para restaurar.';
COMMENT ON COLUMN public.marketing_contents.overlay_original_cta IS
  'Snapshot do CTA sugerido pela IA na primeira geração — usado para restaurar.';
COMMENT ON COLUMN public.marketing_contents.overlay_approved_at IS
  'Timestamp em que o usuário aprovou os overlays; enquanto NULL o render não é enfileirado.';