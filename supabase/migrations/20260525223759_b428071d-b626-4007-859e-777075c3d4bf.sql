-- Adiciona 'confirmada' ao enum de status de visitas (caso ainda não exista)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'confirmada'
      AND enumtypid = 'public.visit_status'::regtype
  ) THEN
    ALTER TYPE public.visit_status ADD VALUE 'confirmada' BEFORE 'concluida';
  END IF;
END $$;

-- Campos extras opcionais para visitas técnicas
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS customer_phone text,
  ADD COLUMN IF NOT EXISTS quote_id uuid,
  ADD COLUMN IF NOT EXISTS product text;
