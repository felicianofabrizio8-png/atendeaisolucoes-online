// Camada de serviço reutilizável da Biblioteca de Áudio.
// A UI e futuros módulos (ex.: gerador de vídeo) consomem esta camada em vez
// de chamar server functions diretamente, o que facilita evolução.

import { supabase } from "@/integrations/supabase/client";
import {
  checkAudioDuplicate,
  createAudio,
  deleteAudio,
  getAudioQuota,
  getAudioSignedUrl,
  listAudios,
  updateAudio,
} from "./audio-library.functions";
import {
  buildAudioStoragePath,
  validateAudioFile,
} from "./audio-library-validation";
import { computeFileSha256 } from "./audio-hash";
import type {
  AudioBrandStyle,
  AudioCategory,
  AudioEnergy,
  AudioLibraryQuery,
  AudioLibraryRow,
  AudioMarketingObjective,
  AudioMood,
  AudioQuotaInfo,
  AudioRecommendedFor,
  AudioSeason,
  AudioTargetAudience,
  AudioVideoDuration,
  AudioVocalType,
} from "./audio-library.types";

const BUCKET = "audio-library";

export interface CreateAudioInput {
  companyId: string;
  file: File;
  name: string;
  description?: string | null;
  category?: AudioCategory | null;
  mood?: AudioMood | null;
  energy?: AudioEnergy | null;
  vocalType?: AudioVocalType | null;
  recommendedFor?: AudioRecommendedFor[];
  source?: string | null;
  commercialUseConfirmed: boolean;
  commercialRightsNotes?: string | null;
  durationSeconds?: number | null;
  marketingObjectives?: AudioMarketingObjective[];
  brandStyles?: AudioBrandStyle[];
  seasons?: AudioSeason[];
  targetAudiences?: AudioTargetAudience[];
  bestVideoDurations?: AudioVideoDuration[];
  preferredStartSecond?: number | null;
  preferredEndSecond?: number | null;
}

export interface SignedAudioUrl {
  url: string;
  expiresAt: Date;
  ttlSeconds: number;
}

/** Erro tipado quando o arquivo já existe na biblioteca. */
export class DuplicateAudioError extends Error {
  readonly existingId: string;
  readonly existingName: string;
  constructor(id: string, name: string) {
    super(`Este arquivo já existe na sua biblioteca ("${name}").`);
    this.name = "DuplicateAudioError";
    this.existingId = id;
    this.existingName = name;
  }
}

/**
 * Faz upload do arquivo para o bucket privado + registra no banco.
 * - Calcula SHA-256 do arquivo e checa duplicidade antes do upload
 *   (evita gastar banda).
 * - Se qualquer etapa falhar, tenta reverter o upload para não deixar órfão.
 */
export async function createAudioWithUpload(
  input: CreateAudioInput,
): Promise<AudioLibraryRow> {
  const validation = validateAudioFile({
    mimeType: input.file.type,
    sizeBytes: input.file.size,
    commercialUseConfirmed: input.commercialUseConfirmed,
  });
  if (!validation.ok) throw new Error(`invalid_file:${validation.reason}`);

  // 1) Hash local para dedupe.
  const sha256 = await computeFileSha256(input.file);

  // 2) Verificação prévia — evita upload desnecessário.
  const dupCheck = await checkAudioDuplicate({ data: { sha256 } });
  if (dupCheck.duplicate) {
    throw new DuplicateAudioError(dupCheck.existing.id, dupCheck.existing.name);
  }

  const audioId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = buildAudioStoragePath({
    companyId: input.companyId,
    audioId,
    originalFilename: input.file.name || "audio",
    mimeType: input.file.type,
  });

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, input.file, {
      contentType: input.file.type || undefined,
      upsert: false,
    });
  if (upErr) throw new Error(`upload_failed:${upErr.message}`);

  try {
    const res = await createAudio({
      data: {
        file_path: path,
        name: input.name,
        description: input.description ?? null,
        original_filename: input.file.name || null,
        mime_type: input.file.type,
        file_size_bytes: input.file.size,
        duration_seconds: input.durationSeconds ?? null,
        category: input.category ?? null,
        mood: input.mood ?? null,
        energy: input.energy ?? null,
        vocal_type: input.vocalType ?? null,
        recommended_for: input.recommendedFor ?? [],
        source: input.source ?? null,
        commercial_use_confirmed: true,
        commercial_rights_notes: input.commercialRightsNotes ?? null,
        sha256,
      },
    });
    return res.audio;
  } catch (e) {
    // rollback do storage
    try {
      await supabase.storage.from(BUCKET).remove([path]);
    } catch {
      /* ignore */
    }
    // Traduz erro "duplicate:<id>:<msg>" para exceção tipada.
    const msg = e instanceof Error ? e.message : String(e);
    const dupMatch = msg.match(/^duplicate:([^:]+):(.+)$/);
    if (dupMatch) throw new DuplicateAudioError(dupMatch[1], dupMatch[2]);
    throw e;
  }
}

export async function listAudioLibrary(
  query: AudioLibraryQuery = {},
): Promise<AudioLibraryRow[]> {
  const res = await listAudios({
    data: {
      category: query.category ?? undefined,
      mood: query.mood ?? undefined,
      energy: query.energy ?? undefined,
      recommended_for: query.recommendedFor ?? undefined,
      search: query.search ?? undefined,
      active_only: query.activeOnly ?? undefined,
    },
  });
  return res.audios;
}

export async function updateAudioMetadata(input: {
  id: string;
  name?: string;
  description?: string | null;
  category?: AudioCategory | null;
  mood?: AudioMood | null;
  energy?: AudioEnergy | null;
  vocalType?: AudioVocalType | null;
  recommendedFor?: AudioRecommendedFor[];
  source?: string | null;
  commercialRightsNotes?: string | null;
  isActive?: boolean;
}): Promise<AudioLibraryRow> {
  const res = await updateAudio({
    data: {
      id: input.id,
      name: input.name,
      description: input.description,
      category: input.category,
      mood: input.mood,
      energy: input.energy,
      vocal_type: input.vocalType,
      recommended_for: input.recommendedFor,
      source: input.source,
      commercial_rights_notes: input.commercialRightsNotes,
      is_active: input.isActive,
    },
  });
  return res.audio;
}

export async function deleteAudioById(id: string): Promise<void> {
  await deleteAudio({ data: { id } });
}

/**
 * Gera uma signed URL "rica" — inclui `expiresAt` para que o player possa
 * agendar renovação automática antes da expiração.
 */
export async function getSignedAudioUrlRich(id: string): Promise<SignedAudioUrl> {
  const res = await getAudioSignedUrl({ data: { id } });
  return {
    url: res.signed_url,
    expiresAt: new Date(res.expires_at),
    ttlSeconds: res.ttl_seconds,
  };
}

/** Retrocompat: retorna apenas a string da URL. */
export async function getSignedAudioUrl(id: string): Promise<string> {
  const res = await getSignedAudioUrlRich(id);
  return res.url;
}

export async function getAudioLibraryQuota(): Promise<AudioQuotaInfo> {
  const res = await getAudioQuota();
  return res.quota;
}
