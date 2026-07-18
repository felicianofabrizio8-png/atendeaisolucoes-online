// ============================================================================
// Render Engine — Types
// Frontend-safe. Compartilhado entre UI, server functions e worker (via cópia).
// ============================================================================

export const VIDEO_FORMATS = ["story", "reels", "feed_square", "feed_4_5"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

export const RENDER_DURATIONS = [8, 10, 15, 30, 60] as const;
export type RenderDuration = (typeof RENDER_DURATIONS)[number];

export const RENDER_STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];

export const VIDEO_FORMAT_DIMENSIONS: Record<
  VideoFormat,
  { width: number; height: number; label: string }
> = {
  story: { width: 1080, height: 1920, label: "Story (9:16)" },
  reels: { width: 1080, height: 1920, label: "Reels (9:16)" },
  feed_square: { width: 1080, height: 1080, label: "Feed Quadrado (1:1)" },
  feed_4_5: { width: 1080, height: 1350, label: "Feed (4:5)" },
};

// ---------------------------------------------------------------------------
// Focal point + image sequence (Fase C.2)
// ---------------------------------------------------------------------------

/**
 * Ponto de foco para o crop do vídeo.
 *  - x, y ∈ [0,1] (fração da imagem original — 0,0 = topo-esquerdo)
 *  - zoom ∈ [1,3] (1 = fit natural, sem ampliação)
 * Quando ausente, o worker aplica crop centralizado (comportamento legado).
 */
export interface FocalPoint {
  x: number;
  y: number;
  zoom: number;
}

export const DEFAULT_FOCAL_POINT: FocalPoint = { x: 0.5, y: 0.5, zoom: 1 };

export function isValidFocalPoint(v: unknown): v is FocalPoint {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const nx = Number(o.x);
  const ny = Number(o.y);
  const nz = Number(o.zoom);
  return (
    Number.isFinite(nx) &&
    Number.isFinite(ny) &&
    Number.isFinite(nz) &&
    nx >= 0 &&
    nx <= 1 &&
    ny >= 0 &&
    ny <= 1 &&
    nz >= 1 &&
    nz <= 3
  );
}

/** Origem de uma imagem da campanha. */
export type CampaignImageOrigin =
  | { source: "marketing_media"; image_id: string }
  | { source: "product_image"; product_id: string; product_image_path: string };

/** Item persistido em `video_render_jobs.image_sequence` (jsonb). */
export interface RenderImageSequenceItem {
  position: number; // 0-based
  primary: boolean;
  source: "marketing_media" | "product_image";
  image_id?: string | null;
  product_id?: string | null;
  product_image_path?: string | null;
  focal_point?: FocalPoint | null;
}

/** Item enviado pela bridge ao worker (com download URL assinada). */
export interface RenderSourceSequenceItem {
  position: number;
  primary: boolean;
  imageDownloadUrl: string;
  focalPoint?: FocalPoint | null;
  durationHint?: number; // fração de segundos do slot no slideshow
}

export const MAX_CAMPAIGN_IMAGES = 8;

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface RenderJobRow {
  id: string;
  company_id: string;
  created_by: string | null;
  image_id: string;
  audio_id: string;
  video_format: VideoFormat;
  audio_start_second: number;
  duration_seconds: number;
  status: RenderStatus;
  progress: number;
  attempt_count: number;
  max_attempts: number;
  error_code: string | null;
  error_message_sanitized: string | null;
  output_video_id: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  image_sequence?: RenderImageSequenceItem[] | null;
  focal_point?: FocalPoint | null;
}

export interface VideoLibraryRow {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  file_path: string;
  thumbnail_path: string | null;
  source_type: string;
  source_image_id: string | null;
  source_audio_id: string | null;
  render_job_id: string | null;
  video_format: VideoFormat;
  width: number;
  height: number;
  duration_seconds: number;
  file_size_bytes: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  mime_type: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const MAX_ACTIVE_JOBS_PER_COMPANY = 3;
