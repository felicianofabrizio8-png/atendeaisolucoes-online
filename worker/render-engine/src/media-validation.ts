import type { FfprobeStreams, VolumeAnalysis } from "./ffprobe.js";

const DURATION_TOLERANCE_SECONDS = 0.35;
const SILENT_MAX_VOLUME_DB = -50;
const SILENT_MEAN_VOLUME_DB = -60;

export interface RenderMediaValidationInput {
  probe: FfprobeStreams;
  volume: VolumeAnalysis;
  expectedWidth: number;
  expectedHeight: number;
  expectedDurationSeconds: number;
}

export type RenderMediaValidationCode =
  | "output_dimensions_mismatch"
  | "output_duration_out_of_tolerance"
  | "bad_video_codec"
  | "bad_pix_fmt"
  | "audio_stream_missing"
  | "audio_stream_silent"
  | "audio_duration_invalid"
  | "audio_format_invalid";

export function validateRenderedMedia(input: RenderMediaValidationInput): RenderMediaValidationCode | null {
  const { probe, volume, expectedWidth, expectedHeight, expectedDurationSeconds } = input;

  if (probe.width !== expectedWidth || probe.height !== expectedHeight) {
    return "output_dimensions_mismatch";
  }
  if (Math.abs(probe.duration - expectedDurationSeconds) > DURATION_TOLERANCE_SECONDS) {
    return "output_duration_out_of_tolerance";
  }
  if (probe.videoCodec !== "h264") return "bad_video_codec";
  if (probe.pixFmt && probe.pixFmt !== "yuv420p") return "bad_pix_fmt";

  if (!probe.audioCodec) return "audio_stream_missing";
  if (probe.audioCodec !== "aac") return "audio_format_invalid";
  if (probe.sampleRate !== 44100 && probe.sampleRate !== 48000) return "audio_format_invalid";
  if ((probe.channels ?? 0) < 1) return "audio_format_invalid";
  if (probe.audioDuration === null || probe.audioDuration <= 0) return "audio_duration_invalid";
  if (Math.abs(probe.audioDuration - expectedDurationSeconds) > DURATION_TOLERANCE_SECONDS) {
    return "audio_duration_invalid";
  }
  if (probe.audioStartTime !== null && probe.audioStartTime > DURATION_TOLERANCE_SECONDS) {
    return "audio_duration_invalid";
  }

  if (isSilentVolume(volume)) return "audio_stream_silent";
  return null;
}

export function isSilentVolume(volume: VolumeAnalysis): boolean {
  if (volume.meanVolumeDb === null || volume.maxVolumeDb === null) return true;
  return volume.maxVolumeDb <= SILENT_MAX_VOLUME_DB || volume.meanVolumeDb <= SILENT_MEAN_VOLUME_DB;
}

export function parseVolumedetectOutput(output: string): VolumeAnalysis {
  const mean = output.match(/mean_volume:\s*(-?[0-9.]+) dB/);
  const max = output.match(/max_volume:\s*(-?[0-9.]+) dB/);
  return {
    meanVolumeDb: mean?.[1] ? Number(mean[1]) : null,
    maxVolumeDb: max?.[1] ? Number(max[1]) : null,
  };
}