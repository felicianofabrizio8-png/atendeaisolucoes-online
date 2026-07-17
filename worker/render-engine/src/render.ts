import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Admin } from "./supabase.js";
import { log } from "./logger.js";
import { renderStaticImageVideo } from "./ffmpeg.js";
import { ffprobe } from "./ffprobe.js";
import type { WorkerConfig } from "./config.js";

const FORMAT_DIMS: Record<string, { width: number; height: number }> = {
  story:       { width: 1080, height: 1920 },
  reels:       { width: 1080, height: 1920 },
  feed_square: { width: 1080, height: 1080 },
};

interface JobRow {
  id: string;
  company_id: string;
  created_by: string | null;
  image_id: string;
  audio_id: string;
  video_format: keyof typeof FORMAT_DIMS;
  audio_start_second: number;
  duration_seconds: number;
  attempt_count: number;
  max_attempts: number;
  output_video_id: string | null;
}

const DURATION_TOLERANCE = 0.25;

export async function processJob(admin: Admin, cfg: WorkerConfig, job: JobRow): Promise<void> {
  // Idempotência: se já existe vídeo produzido para este job, apenas confirma completed.
  const { data: existing } = await admin
    .from("video_library")
    .select("id")
    .eq("render_job_id", job.id)
    .maybeSingle();
  if (existing?.id) {
    log.warn("render_idempotent_skip", { job_id: job.id, existing_video_id: existing.id });
    await admin.from("video_render_jobs").update({
      status: "completed",
      progress: 100,
      completed_at: new Date().toISOString(),
      output_video_id: existing.id,
      locked_at: null, locked_by: null,
    }).eq("id", job.id);
    return;
  }

  const dims = FORMAT_DIMS[job.video_format];
  if (!dims) throw new Error(`unknown_format:${job.video_format}`);

  // Resolve caminhos de origem via service role
  const [{ data: img, error: imgErr }, { data: aud, error: audErr }] = await Promise.all([
    admin.from("marketing_media")
      .select("storage_path, company_id, active, media_type")
      .eq("id", job.image_id).maybeSingle(),
    admin.from("audio_library")
      .select("file_path, company_id, is_active, duration_seconds, mime_type")
      .eq("id", job.audio_id).maybeSingle(),
  ]);
  if (imgErr || !img) throw new Error("source_image_not_found");
  if (audErr || !aud) throw new Error("source_audio_not_found");
  if (img.company_id !== job.company_id) throw new Error("image_cross_tenant");
  if (aud.company_id !== job.company_id) throw new Error("audio_cross_tenant");
  if (!img.active) throw new Error("image_inactive");
  if (!aud.is_active) throw new Error("audio_inactive");
  if (img.media_type !== "image") throw new Error("image_wrong_type");

  await mkdir(cfg.tmpDir, { recursive: true }).catch(() => {});
  const workDir = await mkdtemp(path.join(cfg.tmpDir, `job-${job.id.slice(0, 8)}-`));
  const imageLocal = path.join(workDir, "in-image");
  const audioLocal = path.join(workDir, "in-audio");
  const outputLocal = path.join(workDir, "out.mp4");

  try {
    // Download
    await Promise.all([
      downloadTo(admin, "marketing-media", img.storage_path, imageLocal),
      downloadTo(admin, "audio-library", aud.file_path, audioLocal),
    ]);
    log.info("source_download_completed", { job_id: job.id });
    await updateProgress(admin, job.id, 25);

    // Render
    await renderStaticImageVideo({
      imageFilePath: imageLocal,
      audioFilePath: audioLocal,
      audioStartSecond: Number(job.audio_start_second),
      durationSeconds: Number(job.duration_seconds),
      width: dims.width,
      height: dims.height,
      outputFilePath: outputLocal,
      timeoutMs: cfg.ffmpegTimeoutMs,
    });
    await updateProgress(admin, job.id, 70);

    // Validate
    const probe = await ffprobe(outputLocal, 15_000);
    log.info("ffprobe_validation_completed", {
      job_id: job.id,
      width: probe.width, height: probe.height,
      duration: probe.duration, video_codec: probe.videoCodec, audio_codec: probe.audioCodec,
    });
    if (probe.width !== dims.width || probe.height !== dims.height) {
      throw new Error(`output_dimensions_mismatch:${probe.width}x${probe.height}`);
    }
    if (Math.abs(probe.duration - job.duration_seconds) > DURATION_TOLERANCE) {
      throw new Error(`output_duration_out_of_tolerance:${probe.duration}`);
    }
    if (probe.videoCodec !== "h264") throw new Error(`bad_video_codec:${probe.videoCodec}`);
    if (probe.audioCodec !== "aac")  throw new Error(`bad_audio_codec:${probe.audioCodec}`);
    if (probe.pixFmt && probe.pixFmt !== "yuv420p") {
      throw new Error(`bad_pix_fmt:${probe.pixFmt}`);
    }

    // Upload
    const videoId = randomUUID();
    const storagePath = `${job.company_id}/${videoId}/video.mp4`;
    const bytes = await readFile(outputLocal);
    const { error: upErr } = await admin.storage
      .from("video-library")
      .upload(storagePath, bytes, { contentType: "video/mp4", upsert: false });
    if (upErr) throw new Error(`upload_failed:${upErr.message}`);
    const size = (await stat(outputLocal)).size;
    log.info("video_upload_completed", { job_id: job.id, size_bytes: size });
    await updateProgress(admin, job.id, 90);

    // Insere registro na biblioteca
    const nameDefault = `Render ${new Date().toISOString().replace("T", " ").slice(0, 16)}`;
    const { data: videoRow, error: vErr } = await admin
      .from("video_library")
      .insert({
        id: videoId,
        company_id: job.company_id,
        created_by: job.created_by,
        name: nameDefault,
        file_path: storagePath,
        source_type: "render_engine",
        source_image_id: job.image_id,
        source_audio_id: job.audio_id,
        render_job_id: job.id,
        video_format: job.video_format,
        width: probe.width,
        height: probe.height,
        duration_seconds: probe.duration,
        file_size_bytes: size,
        video_codec: probe.videoCodec,
        audio_codec: probe.audioCodec,
        mime_type: "video/mp4",
      })
      .select("id")
      .single();
    if (vErr) {
      // Se o insert falhar por unique(render_job_id), significa que o vídeo já foi criado.
      const { data: dup } = await admin.from("video_library")
        .select("id").eq("render_job_id", job.id).maybeSingle();
      if (!dup) {
        // Tentar limpar upload para não deixar órfão
        await admin.storage.from("video-library").remove([storagePath]).catch(() => {});
        throw new Error(`video_insert_failed:${vErr.message}`);
      }
      await finalize(admin, job.id, dup.id);
      log.info("render_completed", { job_id: job.id, video_id: dup.id, idempotent: true });
      return;
    }

    await finalize(admin, job.id, videoRow.id);
    log.info("render_completed", { job_id: job.id, video_id: videoRow.id });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function downloadTo(admin: Admin, bucket: string, remotePath: string, localPath: string) {
  const { data, error } = await admin.storage.from(bucket).download(remotePath);
  if (error || !data) throw new Error(`download_failed:${bucket}:${error?.message ?? "no_data"}`);
  const ab = await data.arrayBuffer();
  await writeFile(localPath, Buffer.from(ab));
}

async function updateProgress(admin: Admin, jobId: string, progress: number) {
  await admin.from("video_render_jobs").update({ progress }).eq("id", jobId);
}

async function finalize(admin: Admin, jobId: string, videoId: string) {
  await admin.from("video_render_jobs").update({
    status: "completed",
    progress: 100,
    completed_at: new Date().toISOString(),
    output_video_id: videoId,
    locked_at: null,
    locked_by: null,
    error_code: null,
    error_message_sanitized: null,
  }).eq("id", jobId);
}

/** Sanitiza mensagem: remove tokens, paths absolutos, quebras e trunca. */
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

const BACKOFF_SECONDS = [30, 120, 600];

export async function markFailed(
  admin: Admin, job: JobRow, err: unknown,
): Promise<void> {
  const raw = err instanceof Error ? err.message : String(err);
  const message = sanitizeError(raw);
  const code = message.split(":")[0]?.slice(0, 80) ?? "unknown_error";
  const isFinal = job.attempt_count >= job.max_attempts;

  if (isFinal) {
    await admin.from("video_render_jobs").update({
      status: "failed",
      failed_at: new Date().toISOString(),
      error_code: code,
      error_message_sanitized: message,
      locked_at: null, locked_by: null,
    }).eq("id", job.id);
    log.error("render_failed", { job_id: job.id, attempt: job.attempt_count, error_code: code });
  } else {
    const idx = Math.min(job.attempt_count - 1, BACKOFF_SECONDS.length - 1);
    const backoff = BACKOFF_SECONDS[idx] ?? 600;
    const nextAt = new Date(Date.now() + backoff * 1000).toISOString();
    await admin.from("video_render_jobs").update({
      status: "queued",
      available_at: nextAt,
      error_code: code,
      error_message_sanitized: message,
      locked_at: null, locked_by: null,
      progress: 0,
    }).eq("id", job.id);
    log.warn("render_retry_scheduled", {
      job_id: job.id, attempt: job.attempt_count, backoff_seconds: backoff, error_code: code,
    });
  }
}
