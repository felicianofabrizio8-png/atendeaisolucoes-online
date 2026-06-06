
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS delivery_status text,
  ADD COLUMN IF NOT EXISTS delivery_error_code text,
  ADD COLUMN IF NOT EXISTS delivery_error_message text,
  ADD COLUMN IF NOT EXISTS delivery_error_details jsonb,
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS messages_external_id_idx
  ON public.messages (external_id)
  WHERE external_id IS NOT NULL;
