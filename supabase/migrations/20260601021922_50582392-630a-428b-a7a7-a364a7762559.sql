-- 1. Adiciona valor "em_andamento" ao enum visit_status (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'visit_status' AND e.enumlabel = 'em_andamento'
  ) THEN
    ALTER TYPE public.visit_status ADD VALUE 'em_andamento' BEFORE 'concluida';
  END IF;
END$$;

-- 2. Cria o enum appointment_type (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_type') THEN
    CREATE TYPE public.appointment_type AS ENUM (
      'visita_tecnica',
      'loja',
      'retorno_comercial',
      'pos_venda',
      'instalacao',
      'manutencao'
    );
  END IF;
END$$;

-- 3. Adiciona campos novos à tabela visits
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS appointment_type public.appointment_type NOT NULL DEFAULT 'visita_tecnica',
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS salesperson text,
  ADD COLUMN IF NOT EXISTS technician text;

CREATE INDEX IF NOT EXISTS idx_visits_company_type ON public.visits (company_id, appointment_type);
CREATE INDEX IF NOT EXISTS idx_visits_company_scheduled ON public.visits (company_id, scheduled_at);
