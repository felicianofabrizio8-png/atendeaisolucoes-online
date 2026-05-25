
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS external_message_id text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS viewed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'quote_status' AND e.enumlabel = 'visualizado'
  ) THEN
    ALTER TYPE public.quote_status ADD VALUE 'visualizado' AFTER 'enviado';
  END IF;
END $$;
