
DO $$ BEGIN CREATE TYPE public.marketing_media_type AS ENUM ('image','video');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.marketing_promotion_status AS ENUM ('draft','active','paused','ended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.marketing_content_status AS ENUM ('draft','pending','approved','rejected','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.marketing_content_channel AS ENUM ('instagram','facebook','whatsapp');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.marketing_content_format AS ENUM ('story','feed','reel','whatsapp_cta');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.marketing_schedule_status AS ENUM ('planned','published','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.marketing_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  media_type public.marketing_media_type NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  width INTEGER,
  height INTEGER,
  duration_seconds NUMERIC,
  title TEXT,
  description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_media TO authenticated;
GRANT ALL ON public.marketing_media TO service_role;
ALTER TABLE public.marketing_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mm_select_company" ON public.marketing_media FOR SELECT TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "mm_insert_company" ON public.marketing_media FOR INSERT TO authenticated WITH CHECK (company_id = public.current_company_id());
CREATE POLICY "mm_update_company" ON public.marketing_media FOR UPDATE TO authenticated USING (company_id = public.current_company_id()) WITH CHECK (company_id = public.current_company_id());
CREATE POLICY "mm_delete_admin" ON public.marketing_media FOR DELETE TO authenticated USING (company_id = public.current_company_id() AND public.has_role(auth.uid(), company_id, 'admin'::public.app_role));
CREATE INDEX IF NOT EXISTS idx_mm_company_active ON public.marketing_media(company_id, active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mm_company_type ON public.marketing_media(company_id, media_type);
CREATE TRIGGER trg_mm_updated_at BEFORE UPDATE ON public.marketing_media FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.marketing_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  price_original NUMERIC,
  price_promo NUMERIC,
  discount_percent NUMERIC,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  whatsapp_cta_text TEXT,
  whatsapp_destination TEXT,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  cover_media_id UUID REFERENCES public.marketing_media(id) ON DELETE SET NULL,
  status public.marketing_promotion_status NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_promotions TO authenticated;
GRANT ALL ON public.marketing_promotions TO service_role;
ALTER TABLE public.marketing_promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mp_select_company" ON public.marketing_promotions FOR SELECT TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "mp_insert_company" ON public.marketing_promotions FOR INSERT TO authenticated WITH CHECK (company_id = public.current_company_id());
CREATE POLICY "mp_update_company" ON public.marketing_promotions FOR UPDATE TO authenticated USING (company_id = public.current_company_id()) WITH CHECK (company_id = public.current_company_id());
CREATE POLICY "mp_delete_admin" ON public.marketing_promotions FOR DELETE TO authenticated USING (company_id = public.current_company_id() AND public.has_role(auth.uid(), company_id, 'admin'::public.app_role));
CREATE INDEX IF NOT EXISTS idx_mp_company_status ON public.marketing_promotions(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_company_dates ON public.marketing_promotions(company_id, starts_at, ends_at);
CREATE TRIGGER trg_mp_updated_at BEFORE UPDATE ON public.marketing_promotions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.marketing_contents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  promotion_id UUID REFERENCES public.marketing_promotions(id) ON DELETE SET NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  media_ids UUID[] NOT NULL DEFAULT '{}',
  channel public.marketing_content_channel NOT NULL,
  format public.marketing_content_format NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  hashtags TEXT[] NOT NULL DEFAULT '{}',
  cta_text TEXT,
  cta_destination TEXT,
  ai_model TEXT,
  ai_prompt JSONB,
  ai_raw_output JSONB,
  status public.marketing_content_status NOT NULL DEFAULT 'draft',
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_contents TO authenticated;
GRANT ALL ON public.marketing_contents TO service_role;
ALTER TABLE public.marketing_contents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mc_select_company" ON public.marketing_contents FOR SELECT TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "mc_insert_company" ON public.marketing_contents FOR INSERT TO authenticated WITH CHECK (company_id = public.current_company_id());
CREATE POLICY "mc_update_company" ON public.marketing_contents FOR UPDATE TO authenticated USING (company_id = public.current_company_id()) WITH CHECK (company_id = public.current_company_id());
CREATE POLICY "mc_delete_admin" ON public.marketing_contents FOR DELETE TO authenticated USING (company_id = public.current_company_id() AND public.has_role(auth.uid(), company_id, 'admin'::public.app_role));
CREATE INDEX IF NOT EXISTS idx_mc_company_status ON public.marketing_contents(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mc_company_channel ON public.marketing_contents(company_id, channel, format);
CREATE INDEX IF NOT EXISTS idx_mc_promotion ON public.marketing_contents(promotion_id);
CREATE TRIGGER trg_mc_updated_at BEFORE UPDATE ON public.marketing_contents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.marketing_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES public.marketing_contents(id) ON DELETE CASCADE,
  channel public.marketing_content_channel NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status public.marketing_schedule_status NOT NULL DEFAULT 'planned',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_schedule TO authenticated;
GRANT ALL ON public.marketing_schedule TO service_role;
ALTER TABLE public.marketing_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ms_select_company" ON public.marketing_schedule FOR SELECT TO authenticated USING (company_id = public.current_company_id());
CREATE POLICY "ms_insert_company" ON public.marketing_schedule FOR INSERT TO authenticated WITH CHECK (company_id = public.current_company_id());
CREATE POLICY "ms_update_company" ON public.marketing_schedule FOR UPDATE TO authenticated USING (company_id = public.current_company_id()) WITH CHECK (company_id = public.current_company_id());
CREATE POLICY "ms_delete_company" ON public.marketing_schedule FOR DELETE TO authenticated USING (company_id = public.current_company_id());
CREATE INDEX IF NOT EXISTS idx_ms_company_date ON public.marketing_schedule(company_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_ms_content ON public.marketing_schedule(content_id);
CREATE TRIGGER trg_ms_updated_at BEFORE UPDATE ON public.marketing_schedule FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage policies para bucket marketing-media
CREATE POLICY "Company read marketing media" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'marketing-media' AND (storage.foldername(name))[1] = (public.current_company_id())::text);
CREATE POLICY "Company upload marketing media" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'marketing-media'
    AND (storage.foldername(name))[1] = (public.current_company_id())::text
    AND public.check_storage_quota(public.current_company_id(), COALESCE(((metadata ->> 'size'))::bigint, 0))
  );
CREATE POLICY "Company update marketing media" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'marketing-media' AND (storage.foldername(name))[1] = (public.current_company_id())::text);
CREATE POLICY "Company delete marketing media" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'marketing-media' AND (storage.foldername(name))[1] = (public.current_company_id())::text);
