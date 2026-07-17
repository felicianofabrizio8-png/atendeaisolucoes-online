// ============================================================================
// Render Engine — Types (Phase 1 MVP)
// Frontend-safe. Compartilhado entre UI e server functions.
// ============================================================================

export const VIDEO_FORMATS = ["story", "reels", "feed_square"] as const;
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

export const VIDEO_FORMAT_DIMENSIONS: Record<VideoFormat, { width: number; height: number; label: string }> = {
  story: { width: 1080, height: 1920, label: "Story (9:16)" },
  reels: { width: 1080, height: 1920, label: "Reels (9:16)" },
  feed_square: { width: 1080, height: 1080, label: "Feed Quadrado (1:1)" },
};

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
