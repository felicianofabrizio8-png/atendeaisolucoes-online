ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS product_dimension_required_categories text[] NOT NULL DEFAULT '{}'::text[];

CREATE TABLE IF NOT EXISTS public.product_dimension_backfill_report (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('migrated', 'pending')),
  reason text NOT NULL,
  extracted_length_m numeric,
  extracted_width_m numeric,
  extracted_depth_m numeric,
  reported_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_dimension_backfill_report ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company select product dimension backfill report"
  ON public.product_dimension_backfill_report;
CREATE POLICY "company select product dimension backfill report"
  ON public.product_dimension_backfill_report FOR SELECT TO authenticated
  USING (company_id = private.current_company_id());

CREATE OR REPLACE FUNCTION public.backfill_product_dimensions_from_description()
RETURNS TABLE(migrated_count bigint, pending_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS dimension_backfill_candidates (
    product_id uuid PRIMARY KEY,
    company_id uuid NOT NULL,
    match_count integer NOT NULL,
    length_m numeric,
    width_m numeric,
    depth_m numeric
  ) ON COMMIT DROP;
  TRUNCATE dimension_backfill_candidates;

  INSERT INTO dimension_backfill_candidates
    (product_id, company_id, match_count, length_m, width_m, depth_m)
  SELECT
    p.id,
    p.company_id,
    count(m.parts)::integer,
    CASE WHEN count(m.parts) = 1 THEN max(replace(m.parts[1], ',', '.')::numeric) END,
    CASE WHEN count(m.parts) = 1 THEN max(replace(m.parts[2], ',', '.')::numeric) END,
    CASE WHEN count(m.parts) = 1 THEN max(replace(m.parts[3], ',', '.')::numeric) END
  FROM public.products p
  LEFT JOIN LATERAL regexp_matches(
    coalesce(p.description, ''),
    '(?<![0-9.,])([0-9]{1,2}(?:[.,][0-9]+)?)\s*(?:m(?:etros?)?)?\s*[x×]\s*([0-9]{1,2}(?:[.,][0-9]+)?)\s*(?:m(?:etros?)?)?\s*[x×]\s*([0-9]{1,2}(?:[.,][0-9]+)?)\s*(?:m(?:etros?)?)?(?!\s*[x×])',
    'gi'
  ) AS m(parts) ON true
  WHERE p.length_m IS NULL OR p.width_m IS NULL OR p.depth_m IS NULL
  GROUP BY p.id, p.company_id;

  UPDATE public.products p
  SET length_m = coalesce(p.length_m, c.length_m),
      width_m = coalesce(p.width_m, c.width_m),
      depth_m = coalesce(p.depth_m, c.depth_m)
  FROM dimension_backfill_candidates c
  WHERE p.id = c.product_id
    AND c.match_count = 1
    AND c.length_m > 0 AND c.width_m > 0 AND c.depth_m > 0;

  INSERT INTO public.product_dimension_backfill_report
    (product_id, company_id, status, reason, extracted_length_m,
     extracted_width_m, extracted_depth_m, reported_at)
  SELECT
    c.product_id,
    c.company_id,
    CASE WHEN c.match_count = 1 AND c.length_m > 0 AND c.width_m > 0 AND c.depth_m > 0
      THEN 'migrated' ELSE 'pending' END,
    CASE
      WHEN c.match_count = 0 THEN 'description_without_unambiguous_triple'
      WHEN c.match_count > 1 THEN 'description_with_multiple_triples'
      WHEN c.length_m <= 0 OR c.width_m <= 0 OR c.depth_m <= 0 THEN 'nonpositive_dimension'
      ELSE 'description_single_triple'
    END,
    c.length_m, c.width_m, c.depth_m, now()
  FROM dimension_backfill_candidates c
  ON CONFLICT (product_id) DO UPDATE SET
    status = excluded.status,
    reason = excluded.reason,
    extracted_length_m = excluded.extracted_length_m,
    extracted_width_m = excluded.extracted_width_m,
    extracted_depth_m = excluded.extracted_depth_m,
    reported_at = excluded.reported_at;

  RETURN QUERY
  SELECT
    count(*) FILTER (WHERE status = 'migrated'),
    count(*) FILTER (WHERE status = 'pending')
  FROM public.product_dimension_backfill_report;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_product_dimensions_from_description() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_product_dimensions_from_description() TO service_role;

SELECT * FROM public.backfill_product_dimensions_from_description();

CREATE OR REPLACE FUNCTION public.validate_required_product_dimensions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  required_categories text[];
BEGIN
  SELECT product_dimension_required_categories
    INTO required_categories
  FROM public.company_settings
  WHERE company_id = NEW.company_id;

  IF NEW.category = ANY(coalesce(required_categories, '{}'::text[]))
     AND (NEW.length_m IS NULL OR NEW.width_m IS NULL OR NEW.depth_m IS NULL) THEN
    RAISE EXCEPTION 'product_dimensions_required_for_category'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_required_product_dimensions ON public.products;
CREATE TRIGGER trg_validate_required_product_dimensions
  BEFORE INSERT OR UPDATE OF company_id, category, length_m, width_m, depth_m
  ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.validate_required_product_dimensions();
