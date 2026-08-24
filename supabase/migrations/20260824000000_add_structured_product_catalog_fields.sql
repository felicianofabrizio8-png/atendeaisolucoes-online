-- Fase 2A: atributos estruturados e opcionais do catálogo.
-- Totalmente idempotente e retrocompatível:
-- produtos existentes permanecem válidos e não recebem dados inferidos.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS length_m numeric,
  ADD COLUMN IF NOT EXISTS width_m numeric,
  ADD COLUMN IF NOT EXISTS depth_m numeric,
  ADD COLUMN IF NOT EXISTS capacity_l numeric,
  ADD COLUMN IF NOT EXISTS shape text,
  ADD COLUMN IF NOT EXISTS specifications jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS included_items text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS variants jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_length_m_nonnegative'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_length_m_nonnegative
      CHECK (length_m IS NULL OR length_m >= 0);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_width_m_nonnegative'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_width_m_nonnegative
      CHECK (width_m IS NULL OR width_m >= 0);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_depth_m_nonnegative'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_depth_m_nonnegative
      CHECK (depth_m IS NULL OR depth_m >= 0);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_capacity_l_nonnegative'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_capacity_l_nonnegative
      CHECK (capacity_l IS NULL OR capacity_l >= 0);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_specifications_object'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_specifications_object
      CHECK (jsonb_typeof(specifications) = 'object');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_variants_array'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_variants_array
      CHECK (jsonb_typeof(variants) = 'array');
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_company_sku
  ON public.products (company_id, lower(btrim(sku)))
  WHERE sku IS NOT NULL
    AND btrim(sku) <> '';

CREATE INDEX IF NOT EXISTS idx_products_company_active_length
  ON public.products (company_id, active, length_m)
  WHERE active = true
    AND length_m IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_company_active_shape
  ON public.products (company_id, active, lower(shape))
  WHERE active = true
    AND shape IS NOT NULL
    AND btrim(shape) <> '';
