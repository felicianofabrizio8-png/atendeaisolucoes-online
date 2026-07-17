// Pure validation + sanitization helpers for the Audio Library.
// Kept side-effect free so they can run in both browser and server, and be
// unit tested without any Supabase mocks.

import {
  AUDIO_ALLOWED_MIME_TYPES,
  AUDIO_BRAND_STYLES,
  AUDIO_CATEGORIES,
  AUDIO_ENERGIES,
  AUDIO_MARKETING_OBJECTIVES,
  AUDIO_MAX_FILE_BYTES,
  AUDIO_MOODS,
  AUDIO_RECOMMENDED_FOR,
  AUDIO_SEASONS,
  AUDIO_TARGET_AUDIENCES,
  AUDIO_VIDEO_DURATIONS,
  AUDIO_VOCAL_TYPES,
  type AudioBrandStyle,
  type AudioCategory,
  type AudioEnergy,
  type AudioMarketingObjective,
  type AudioMimeType,
  type AudioMood,
  type AudioRecommendedFor,
  type AudioSeason,
  type AudioTargetAudience,
  type AudioVideoDuration,
  type AudioVocalType,
} from "./audio-library.types";

export interface FileValidationInput {
  mimeType: string;
  sizeBytes: number;
  commercialUseConfirmed: boolean;
}

export interface FileValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateAudioFile(input: FileValidationInput): FileValidationResult {
  if (!input.commercialUseConfirmed) {
    return { ok: false, reason: "commercial_use_not_confirmed" };
  }
  if (!AUDIO_ALLOWED_MIME_TYPES.includes(input.mimeType as AudioMimeType)) {
    return { ok: false, reason: `mime_type_not_allowed:${input.mimeType}` };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, reason: "invalid_size" };
  }
  if (input.sizeBytes > AUDIO_MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: `file_too_large:${input.sizeBytes}>${AUDIO_MAX_FILE_BYTES}`,
    };
  }
  return { ok: true };
}

/**
 * Sanitiza o nome original do arquivo para uso seguro no storage.
 * - Remove caracteres não [a-zA-Z0-9._-]
 * - Colapsa espaços em "-"
 * - Limita comprimento a 120 caracteres
 * - Sempre retorna um nome não vazio (fallback: "audio")
 */
export function sanitizeAudioFilename(name: string): string {
  const trimmed = (name ?? "").trim();
  const base = trimmed.length ? trimmed : "audio";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  const finalName = cleaned.length ? cleaned : "audio";
  return finalName.slice(0, 120);
}

/** Deriva a extensão a partir do mimeType. */
export function extForAudioMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m === "audio/wav" || m === "audio/x-wav") return "wav";
  return "mp3";
}

/**
 * Monta o path final dentro do bucket `audio-library`.
 * Estrutura: {companyId}/{audioId}/{filename}.{ext}
 * O bucket + RLS depende de foldername[1] == companyId.
 */
export function buildAudioStoragePath(input: {
  companyId: string;
  audioId: string;
  originalFilename: string;
  mimeType: string;
}): string {
  const ext = extForAudioMime(input.mimeType);
  const bareName = input.originalFilename.replace(/\.[a-zA-Z0-9]+$/, "");
  const safeName = sanitizeAudioFilename(bareName) || "audio";
  return `${input.companyId}/${input.audioId}/${safeName}.${ext}`;
}

/**
 * Extrai o companyId de um path do bucket `audio-library`. Devolve null se o
 * path não segue a estrutura esperada.
 */
export function extractCompanyIdFromAudioPath(path: string): string | null {
  if (!path) return null;
  const clean = path.replace(/^\/+/, "");
  const idx = clean.indexOf("/");
  if (idx <= 0) return null;
  return clean.slice(0, idx);
}

// ---------- Enum guards ----------

export function isAudioCategory(v: unknown): v is AudioCategory {
  return typeof v === "string" && (AUDIO_CATEGORIES as string[]).includes(v);
}
export function isAudioMood(v: unknown): v is AudioMood {
  return typeof v === "string" && (AUDIO_MOODS as string[]).includes(v);
}
export function isAudioEnergy(v: unknown): v is AudioEnergy {
  return typeof v === "string" && (AUDIO_ENERGIES as string[]).includes(v);
}
export function isAudioVocalType(v: unknown): v is AudioVocalType {
  return typeof v === "string" && (AUDIO_VOCAL_TYPES as string[]).includes(v);
}
export function isAudioRecommendedFor(v: unknown): v is AudioRecommendedFor {
  return (
    typeof v === "string" && (AUDIO_RECOMMENDED_FOR as string[]).includes(v)
  );
}
export function sanitizeRecommendedForList(v: unknown): AudioRecommendedFor[] {
  if (!Array.isArray(v)) return [];
  const out: AudioRecommendedFor[] = [];
  for (const item of v) {
    if (isAudioRecommendedFor(item) && !out.includes(item)) out.push(item);
  }
  return out;
}
