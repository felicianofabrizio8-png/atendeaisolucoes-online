import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { log } from "./logger.js";
import { renderStaticImageVideo } from "./ffmpeg.js";
import { analyzeVolume, ffprobe } from "./ffprobe.js";
import { validateRenderedMedia } from "./media-validation.js";
import type { WorkerConfig } from "./config.js";
import {
  type ClaimedJob,
  downloadSignedUrl,
  reportComplete,
  reportFail,
  reportProgress,
  uploadSignedUrl,
} from "./api-client.js";

const DURATION_TOLERANCE = 0.25;

export function sanitizeError(msg: string): string {
  return msg
    .replace(/(Bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/(apikey=)[^\s&]+/gi, "$1[redacted]")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/\/(tmp|home|root|var)\/\S+/g, "[path]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export async function processClaim(cfg: WorkerConfig, claim: ClaimedJob): Promise<void> {
  const { job, source, output } = claim;
  const t0 = Date.now();

  await mkdir(cfg.tmpDir, { recursive: true }).catch(() => {});
  const workDir = await mkdtemp(path.join(cfg.tmpDir, `job-${job.id.slice(0, 8)}-`));
  const imageLocal = path.join(workDir, "in-image");
  const audioLocal = path.join(workDir, "in-audio");
  const outputLocal = path.join(workDir, "out.mp4");

  let stage: string = "downloading_sources";
  try {
    log.info("bridge_claim_received", {
      job_id: job.id,
      company_id: job.companyId,
      video_format: job.videoFormat,
      duration_seconds: job.durationSeconds,
      attempt: job.attemptCount,
    });

    // 1. Download
    log.info("signed_source_download_started", { job_id: job.id });
    await reportProgress(cfg, job.id, "downloading_sources", 10);
    const [imgBuf, audBuf] = await Promise.all([
      downloadSignedUrl(source.imageDownloadUrl, cfg.httpTimeoutMs),
      downloadSignedUrl(source.audioDownloadUrl, cfg.httpTimeoutMs),
    ]);
    await writeFile(imageLocal, Buffer.from(imgBuf));
    await writeFile(audioLocal, Buffer.from(audBuf));
    log.info("signed_source_download_completed", { job_id: job.id });
    await reportProgress(cfg, job.id, "downloading_sources", 25);

    // 2. Render
    stage = "rendering";
    await reportProgress(cfg, job.id, "rendering", 30);
    const audioStartSecond = Number(job.audioStartSecond);
    const durationSeconds = Number(job.durationSeconds);
    if (!Number.isFinite(audioStartSecond) || audioStartSecond < 0) {
      throw new Error("audio_offset_invalid");
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error("audio_duration_invalid");
    }

    await renderStaticImageVideo({
      imageFilePath: imageLocal,
      audioFilePath: audioLocal,
      audioStartSecond,
      durationSeconds,
      width: job.width,
      height: job.height,
      outputFilePath: outputLocal,
      timeoutMs: cfg.ffmpegTimeoutMs,
    });
    await reportProgress(cfg, job.id, "rendering", 65);

    // 3. Validate
    stage = "validating";
    await reportProgress(cfg, job.id, "validating", 70);
    const probe = await ffprobe(outputLocal, 15_000);
    const volume = await analyzeVolume(outputLocal, 15_000);
    log.info("ffprobe_validation_completed", {
      job_id: job.id,
      width: probe.width, height: probe.height,
      duration: probe.duration,
      video_duration: probe.videoDuration,
      audio_duration: probe.audioDuration,
      video_codec: probe.videoCodec,
      audio_codec: probe.audioCodec,
      audio_sample_rate: probe.sampleRate,
      audio_channels: probe.channels,
      audio_channel_layout: probe.channelLayout,
      audio_bit_rate: probe.audioBitRate,
      audio_start_time: probe.audioStartTime,
      audio_disposition_default: probe.audioDispositionDefault,
      mean_volume_db: volume.meanVolumeDb,
      max_volume_db: volume.maxVolumeDb,
    });
    const validationCode = validateRenderedMedia({
      probe,
      volume,
      expectedWidth: job.width,
      expectedHeight: job.height,
      expectedDurationSeconds: durationSeconds,
    });
    if (validationCode) {
      throw new Error(validationCode);
    }

    // 4. Upload
    stage = "uploading";
    log.info("signed_video_upload_started", { job_id: job.id });
    await reportProgress(cfg, job.id, "uploading", 85);
    const bytes = await readFile(outputLocal);
    await uploadSignedUrl(output.uploadUrl, bytes, "video/mp4", Math.max(cfg.httpTimeoutMs, 60_000));
    const size = (await stat(outputLocal)).size;
    log.info("signed_video_upload_completed", { job_id: job.id, size_bytes: size });

    // 5. Complete
    stage = "finalizing";
    await reportProgress(cfg, job.id, "finalizing", 95);
    const result = await reportComplete(cfg, job.id, {
      videoId: output.videoId,
      filePath: output.filePath,
      width: probe.width,
      height: probe.height,
      durationSeconds: probe.duration,
      fileSizeBytes: size,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      pixelFormat: probe.pixFmt ?? "yuv420p",
      mimeType: "video/mp4",
      renderElapsedMs: Date.now() - t0,
    });
    log.info("bridge_complete_confirmed", {
      job_id: job.id, video_id: result.videoId, idempotent: !!result.idempotent,
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const message = sanitizeError(raw);
    const code = message.split(":")[0]?.slice(0, 80) ?? "unknown_error";
    log.error("render_failed", { job_id: job.id, stage, code });
    await reportFail(cfg, job.id, stage, code, message).catch(() => {});
    log.info("bridge_fail_confirmed", { job_id: job.id, stage, code });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
