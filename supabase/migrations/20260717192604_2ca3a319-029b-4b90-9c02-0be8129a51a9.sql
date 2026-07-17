
-- ============================================================================
-- Audio Library — Fase 1: infraestrutura de biblioteca de áudio por empresa
-- ============================================================================

CREATE TABLE public.audio_library (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  file_path text NOT NULL,
  original_filename text,
  mime_type text NOT NULL,
  file_size_bytes bigint,
  duration_seconds numeric,
  category text,
  mood text,
  energy text,
  vocal_type text,
  recommended_for text[] NOT NULL DEFAULT '{}',
  source text,
  commercial_use_confirmed boolean NOT NULL DEFAULT false,
  commercial_rights_notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audio_library_commercial_use_required CHECK (commercial_use_confirmed = true),
  CONSTRAINT audio_library_category_check CHECK (category IS NULL OR category IN (
    'tropical','resort','familia','promocional','elegante','institucional',
    'motivacional','infantil','fashion','comemorativa','outros'
  )),
  CONSTRAINT audio_library_mood_check CHECK (mood IS NULL OR mood IN (
    'alegre','relaxante','emocionante','sofisticado','energetico','leve','divertido','inspirador'
  )),
  CONSTRAINT audio_library_energy_check CHECK (energy IS NULL OR energy IN ('baixa','media','alta')),
  CONSTRAINT audio_library_vocal_check CHECK (vocal_type IS NULL OR vocal_type IN (
    'instrumental','vocal','jingle','efeitos'
  )),
  CONSTRAINT audio_library_mime_check CHECK (mime_type IN (
    'audio/mpeg','audio/mp3','audio/wav','audio/x-wav'
  ))
);

CREATE INDEX idx_audio_library_company ON public.audio_library(company_id) WHERE is_active = true;
CREATE INDEX idx_audio_library_company_category ON public.audio_library(company_id, category);
CREATE INDEX idx_audio_library_company_mood ON public.audio_library(company_id, mood);
CREATE INDEX idx_audio_library_company_energy ON public.audio_library(company_id, energy);
CREATE INDEX idx_audio_library_recommended_for ON public.audio_library USING gin(recommended_for);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audio_library TO authenticated;
GRANT ALL ON public.audio_library TO service_role;

ALTER TABLE public.audio_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audio_library_select_own_company"
  ON public.audio_library FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "audio_library_insert_own_company"
  ON public.audio_library FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = public.current_company_id()
    AND created_by = auth.uid()
  );

CREATE POLICY "audio_library_update_own_company"
  ON public.audio_library FOR UPDATE
  TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "audio_library_delete_own_company"
  ON public.audio_library FOR DELETE
  TO authenticated
  USING (company_id = public.current_company_id());

CREATE TRIGGER audio_library_set_updated_at
  BEFORE UPDATE ON public.audio_library
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- Storage RLS: bucket audio-library (será criado via tool storage_create_bucket).
-- Estrutura: {company_id}/{audio_id}/{filename}
-- ============================================================================

CREATE POLICY "audio_library_storage_select_own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'audio-library'
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );

CREATE POLICY "audio_library_storage_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'audio-library'
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );

CREATE POLICY "audio_library_storage_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'audio-library'
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );

CREATE POLICY "audio_library_storage_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'audio-library'
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );
