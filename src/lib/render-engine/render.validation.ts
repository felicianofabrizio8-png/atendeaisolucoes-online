// ============================================================================
// Render Engine — Validation (frontend-safe, pure functions)
// ============================================================================

import { z } from "zod";
import {
  RENDER_DURATIONS,
  VIDEO_FORMATS,
  type RenderDuration,
  type VideoFormat,
} from "./render.types";

export const createRenderJobSchema = z.object({
  image_id: z.string().uuid(),
  audio_id: z.string().uuid(),
  video_format: z.enum(VIDEO_FORMATS),
  audio_start_second: z.number().finite().min(0).max(3600),
  duration_seconds: z.number().int().refine(
    (v): v is RenderDuration => (RENDER_DURATIONS as readonly number[]).includes(v),
    { message: "duration_seconds_not_allowed" },
  ),
});
export type CreateRenderJobInput = z.infer<typeof createRenderJobSchema>;

export interface RangeCheckInput {
  audio_duration_seconds: number;
  audio_start_second: number;
  duration_seconds: number;
}

/** Retorna null se válido, ou uma string com o motivo. */
export function validateAudioRange({
  audio_duration_seconds,
  audio_start_second,
  duration_seconds,
}: RangeCheckInput): string | null {
  if (!Number.isFinite(audio_duration_seconds) || audio_duration_seconds <= 0) {
    return "audio_duration_invalid";
  }
  if (audio_start_second < 0) return "audio_start_negative";
  if (duration_seconds <= 0) return "duration_non_positive";
  if (audio_start_second + duration_seconds > audio_duration_seconds + 0.001) {
    return "audio_slice_exceeds_duration";
  }
  return null;
}

export function formatVideoTimeLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function suggestStartSecond(
  audioPreferredStart: number | null | undefined,
  audioDurationSeconds: number,
  requestedDuration: number,
): number {
  const maxStart = Math.max(0, audioDurationSeconds - requestedDuration);
  const pref = typeof audioPreferredStart === "number" && audioPreferredStart >= 0
    ? audioPreferredStart
    : 0;
  return Math.min(pref, maxStart);
}

export function isVideoFormat(v: unknown): v is VideoFormat {
  return typeof v === "string" && (VIDEO_FORMATS as readonly string[]).includes(v);
}
