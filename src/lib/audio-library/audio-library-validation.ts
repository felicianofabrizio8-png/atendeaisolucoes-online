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

// ============================================================================
// Sanitizadores dos novos metadados (fase de enriquecimento).
// Todos: rejeitam valores desconhecidos, removem duplicados preservando ordem
// de primeira aparição e sempre devolvem um array (nunca null/undefined).
// ============================================================================

function sanitizeStringEnumList<T extends string>(
  input: unknown,
  allowed: readonly T[],
): T[] {
  if (!Array.isArray(input)) return [];
  const allowedSet = new Set<string>(allowed);
  const out: T[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    if (!allowedSet.has(item)) continue;
    if (!out.includes(item as T)) out.push(item as T);
  }
  return out;
}

export function isAudioMarketingObjective(v: unknown): v is AudioMarketingObjective {
  return (
    typeof v === "string" && (AUDIO_MARKETING_OBJECTIVES as string[]).includes(v)
  );
}
export function sanitizeMarketingObjectiveList(v: unknown): AudioMarketingObjective[] {
  return sanitizeStringEnumList(v, AUDIO_MARKETING_OBJECTIVES);
}

export function isAudioBrandStyle(v: unknown): v is AudioBrandStyle {
  return typeof v === "string" && (AUDIO_BRAND_STYLES as string[]).includes(v);
}
export function sanitizeBrandStyleList(v: unknown): AudioBrandStyle[] {
  return sanitizeStringEnumList(v, AUDIO_BRAND_STYLES);
}

export function isAudioSeason(v: unknown): v is AudioSeason {
  return typeof v === "string" && (AUDIO_SEASONS as string[]).includes(v);
}

/**
 * Sanitiza estações e aplica a regra de exclusividade de "todas":
 * se "todas" aparece, o resultado é apenas ["todas"] (descarta os demais).
 */
export function sanitizeSeasonList(v: unknown): AudioSeason[] {
  const base = sanitizeStringEnumList(v, AUDIO_SEASONS);
  if (base.includes("todas")) return ["todas"];
  return base;
}

export function isAudioTargetAudience(v: unknown): v is AudioTargetAudience {
  return (
    typeof v === "string" && (AUDIO_TARGET_AUDIENCES as string[]).includes(v)
  );
}
export function sanitizeTargetAudienceList(v: unknown): AudioTargetAudience[] {
  return sanitizeStringEnumList(v, AUDIO_TARGET_AUDIENCES);
}

export function isAudioVideoDuration(v: unknown): v is AudioVideoDuration {
  return (
    typeof v === "number" &&
    Number.isInteger(v) &&
    (AUDIO_VIDEO_DURATIONS as number[]).includes(v)
  );
}

/**
 * Sanitiza durações recomendadas — aceita number ou string numérica ("15"),
 * rejeita valores fora da whitelist e remove duplicados.
 */
export function sanitizeVideoDurationList(v: unknown): AudioVideoDuration[] {
  if (!Array.isArray(v)) return [];
  const out: AudioVideoDuration[] = [];
  for (const item of v) {
    const n = typeof item === "string" ? Number(item) : item;
    if (!isAudioVideoDuration(n)) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

// ============================================================================
// Validação do intervalo preferido (preferred_start_second / _end_second).
// Regra: ambos nulos OU ambos preenchidos, start>=0, end>start, e — quando
// duration_seconds está definido — nenhum ultrapassa a duração.
// ============================================================================

export type PreferredRangeReason =
  | "start_only"
  | "end_only"
  | "start_negative"
  | "end_not_greater_than_start"
  | "start_out_of_duration"
  | "end_out_of_duration"
  | "not_integer";

export interface PreferredRangeInput {
  start: number | null | undefined;
  end: number | null | undefined;
  durationSeconds?: number | null;
}

export interface PreferredRangeResult {
  ok: boolean;
  reason?: PreferredRangeReason;
  start: number | null;
  end: number | null;
}

export function validatePreferredRange(
  input: PreferredRangeInput,
): PreferredRangeResult {
  const rawStart = input.start;
  const rawEnd = input.end;
  const startPresent = rawStart != null;
  const endPresent = rawEnd != null;
  if (!startPresent && !endPresent) return { ok: true, start: null, end: null };
  if (startPresent && !endPresent)
    return { ok: false, reason: "start_only", start: null, end: null };
  if (!startPresent && endPresent)
    return { ok: false, reason: "end_only", start: null, end: null };
  const start = Number(rawStart);
  const end = Number(rawEnd);
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return { ok: false, reason: "not_integer", start: null, end: null };
  }
  if (start < 0)
    return { ok: false, reason: "start_negative", start: null, end: null };
  if (end <= start)
    return {
      ok: false,
      reason: "end_not_greater_than_start",
      start: null,
      end: null,
    };
  if (input.durationSeconds != null && Number.isFinite(input.durationSeconds)) {
    if (start > input.durationSeconds)
      return { ok: false, reason: "start_out_of_duration", start: null, end: null };
    if (end > input.durationSeconds)
      return { ok: false, reason: "end_out_of_duration", start: null, end: null };
  }
  return { ok: true, start, end };
}
