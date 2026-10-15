-- Buckets de Storage usados pelo Marketing IA e pelo render de vídeo.
--
-- As políticas de acesso destes buckets já estão versionadas em
-- supabase/migrations, mas os buckets em si foram criados pelo painel e não
-- existem em nenhuma migration. Sem este arquivo, um banco recriado do zero
-- fica sem `marketing-media`, `audio-library`, `video-library`,
-- `brand-assets` e `whatsapp-media`.
--
-- Idempotente: em um banco onde os buckets já existem (produção) não altera
-- nada, nem a configuração de público/privado.

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('marketing-media', 'marketing-media', false),
  ('audio-library', 'audio-library', false),
  ('video-library', 'video-library', false),
  ('brand-assets', 'brand-assets', false),
  ('whatsapp-media', 'whatsapp-media', false)
ON CONFLICT (id) DO NOTHING;
