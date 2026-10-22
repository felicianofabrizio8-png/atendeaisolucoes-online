-- supabase/migrations/20261017180000_profile_customization.sql
-- ============================================================================
-- Perfil personalizável: foto, banner (imagem ou gradiente), recado e
-- telefone. Imagens ficam no bucket público "profile-media", na pasta do
-- próprio usuário (<user_id>/...). Aditiva e reexecutável.
-- ============================================================================

-- ---------- 1. Colunas do perfil ----------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS banner_url text,
  ADD COLUMN IF NOT EXISTS banner_preset text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS phone text;

DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_bio_length CHECK (char_length(bio) <= 140);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_phone_length CHECK (char_length(phone) <= 32);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_banner_preset_length CHECK (char_length(banner_preset) <= 32);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- 2. Bucket das imagens de perfil ----------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('profile-media', 'profile-media', true, 5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Leitura pública (bucket público); escrita só na própria pasta.
DROP POLICY IF EXISTS "profile-media: own insert" ON storage.objects;
CREATE POLICY "profile-media: own insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'profile-media' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "profile-media: own update" ON storage.objects;
CREATE POLICY "profile-media: own update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'profile-media' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "profile-media: own delete" ON storage.objects;
CREATE POLICY "profile-media: own delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'profile-media' AND (storage.foldername(name))[1] = auth.uid()::text);
