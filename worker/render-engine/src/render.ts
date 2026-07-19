import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { log } from "./logger.js";
import { renderSlideshowWithAudio, renderStaticImageVideo, type FocalPoint, type WatermarkInput, type WatermarkPosition } from "./ffmpeg.js";
import { composeBrandLayers } from "./brand-composer.js";

import { analyzeVolume, ffprobe, ffprobeInput } from "./ffprobe.js";
import { validateRenderedMedia } from "./media-validation.js";
import type { WorkerConfig } from "./config.js";
import {
  type ClaimedJob,
  downloadSignedUrlWithMeta,
  reportComplete,
  reportFail,
  reportProgress,
  uploadSignedUrl,
} from "./api-client.js";
import { fingerprintFile, memorySnapshot, redactUrl, validateAudioRange } from "./telemetry.js";
import { setActiveJobId } from "./runtime-state.js";

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

  setActiveJobId(job.id);
  await mkdir(cfg.tmpDir, { recursive: true }).catch(() => {});
  const workDir = await mkdtemp(path.join(cfg.tmpDir, `job-${job.id.slice(0, 8)}-`));
  const audioLocal = path.join(workDir, "in-audio");
  const outputLocal = path.join(workDir, "out.mp4");

  const baseCtx = {
    job_id: job.id,
    company_id: job.companyId,
    worker_id: job.workerId,
    attempt: job.attemptCount,
  };

  let stage: string = "downloading_sources";
  try {
    const sequence = Array.isArray(source.imageSequence) && source.imageSequence.length > 0
      ? source.imageSequence
      : null;
    const useSlideshow = !!sequence && sequence.length > 1;

    log.info("bridge_claim_received", {
      ...baseCtx,
      stage,
      video_format: job.videoFormat,
      duration_seconds: job.durationSeconds,
      images_count: sequence?.length ?? 1,
      slideshow: useSlideshow,
      has_focal_point: !!source.focalPoint,
    });

    // 1. Download
    log.info("signed_source_download_started", { ...baseCtx, stage });
    await reportProgress(cfg, job.id, "downloading_sources", 10);

    const imageDownloads: string[] = [];
    const focalPoints: Array<FocalPoint | null> = [];

    if (sequence) {
      const ordered = [...sequence].sort((a, b) => a.position - b.position);
      const results = await Promise.all(
        ordered.map((s) => downloadSignedUrlWithMeta(s.imageDownloadUrl, cfg.httpTimeoutMs)),
      );
      for (let i = 0; i < ordered.length; i++) {
        const p = path.join(workDir, `in-image-${i}`);
        await writeFile(p, Buffer.from(results[i].bytes));
        imageDownloads.push(p);
        focalPoints.push((ordered[i].focalPoint as FocalPoint | null) ?? null);
        log.info("signed_image_download_completed", {
          ...baseCtx,
          stage,
          index: i,
          host: results[i].meta.finalHost,
          pathname: results[i].meta.finalPathname,
          http_status: results[i].meta.status,
          content_type: results[i].meta.contentType,
          content_length: results[i].meta.contentLength,
          downloaded_bytes: results[i].meta.downloadedBytes,
          elapsed_ms: results[i].meta.elapsedMs,
          redirected: results[i].meta.redirected,
        });
      }
    } else {
      const imgLocal = path.join(workDir, "in-image-0");
      const { bytes: imgBuf, meta: imgMeta } = await downloadSignedUrlWithMeta(
        source.imageDownloadUrl,
        cfg.httpTimeoutMs,
      );
      await writeFile(imgLocal, Buffer.from(imgBuf));
      imageDownloads.push(imgLocal);
      focalPoints.push((source.focalPoint as FocalPoint | null) ?? null);
      log.info("signed_image_download_completed", {
        ...baseCtx,
        stage,
        index: 0,
        host: imgMeta.finalHost,
        pathname: imgMeta.finalPathname,
        http_status: imgMeta.status,
        content_type: imgMeta.contentType,
        content_length: imgMeta.contentLength,
        downloaded_bytes: imgMeta.downloadedBytes,
        elapsed_ms: imgMeta.elapsedMs,
        redirected: imgMeta.redirected,
      });
    }

    // --- Áudio: download com telemetria completa ------------------------
    const audioUrlRedacted = redactUrl(source.audioDownloadUrl);
    log.info("signed_audio_download_started", {
      ...baseCtx,
      stage,
      host: audioUrlRedacted.host,
      pathname: audioUrlRedacted.pathname,
      had_query: audioUrlRedacted.hasQuery,
    });
    const { bytes: audBuf, meta: audMeta } = await downloadSignedUrlWithMeta(
      source.audioDownloadUrl,
      cfg.httpTimeoutMs,
    );
    await writeFile(audioLocal, Buffer.from(audBuf));
    const audioFp = await fingerprintFile(audioLocal);
    log.info("signed_audio_download_completed", {
      ...baseCtx,
      stage,
      host: audMeta.finalHost,
      pathname: audMeta.finalPathname,
      http_status: audMeta.status,
      content_type: audMeta.contentType,
      content_length: audMeta.contentLength,
      downloaded_bytes: audMeta.downloadedBytes,
      elapsed_ms: audMeta.elapsedMs,
      redirected: audMeta.redirected,
      tmp_path: audioLocal,
      file_size_bytes: audioFp.sizeBytes,
      sha256: audioFp.sha256,
      head_hex: audioFp.headHex,
      likely_format: audioFp.likelyFormat,
    });

    log.info("signed_source_download_completed", {
      ...baseCtx,
      stage,
      images: imageDownloads.length,
    });

    // ---- Fase 5.A + 5.B1: watermark + brand layers ---------------------
    // Estratégia:
    //   1. Se há logo assinada, faz download (watermark clássico).
    //   2. Se há videoBrand com conteúdo (headline/cta/companyName), gera
    //      camadas SVG→PNG (painel inferior + tela final) via composer.
    //   3. Falhas nas camadas nunca fazem o job falhar — o worker segue
    //      renderizando com o que conseguiu preparar.
    let watermark: WatermarkInput | null = null;
    const brand = claim.videoBrand ?? null;
    const hasWatermarkable = !!(brand?.enabled && brand.watermark?.enabled && brand.logo && brand.logoDownloadUrl);
    const hasContent = !!(brand?.enabled && (brand.content || brand.outro?.enabled));

    if (brand && (hasWatermarkable || hasContent)) {
      let logoLocal: string | null = null;
      if (hasWatermarkable) {
        try {
          logoLocal = path.join(workDir, "in-logo");
          const { bytes: logoBuf, meta: logoMeta } = await downloadSignedUrlWithMeta(
            brand.logoDownloadUrl!,
            cfg.httpTimeoutMs,
          );
          await writeFile(logoLocal, Buffer.from(logoBuf));
          log.info("brand_watermark_prepared", {
            ...baseCtx,
            stage,
            brand_version_id: brand.brandVersionId,
            asset_id: brand.logo?.assetId ?? null,
            position: brand.tokens.logoPosition,
            max_width_ratio: brand.watermark.maxWidthRatio,
            opacity: brand.watermark.opacity,
            logo_bytes: logoMeta.downloadedBytes,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn("brand_watermark_skipped", {
            ...baseCtx, stage, reason: sanitizeError(msg),
          });
          logoLocal = null;
        }
      }

      // --- Composer (Fase 5.B1): painel inferior + tela final -----------
      let bottomPanelPath: string | null = null;
      let outroCardPath: string | null = null;
      let outroDurationSeconds = 0;
      if (hasContent) {
        try {
          const layers = await composeBrandLayers({
            videoBrand: brand,
            logoLocalPath: logoLocal,
            logoMimeType: brand.logo?.mimeType ?? null,
            width: job.width,
            height: job.height,
            workDir,
            jobId: job.id,
          });
          bottomPanelPath = layers.bottomPanelPath;
          outroCardPath = layers.outroCardPath;
          outroDurationSeconds = layers.outroDurationSeconds;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn("brand_composer_failed", {
            ...baseCtx, stage, reason: sanitizeError(msg),
          });
        }
      }

      if (logoLocal || bottomPanelPath || outroCardPath) {
        watermark = {
          logoFilePath: logoLocal,
          position: (brand.tokens.logoPosition as WatermarkPosition) ?? "bottom-right",
          maxWidthRatio: brand.watermark?.maxWidthRatio ?? 0.14,
          opacity: brand.watermark?.opacity ?? 0.85,
          safeMarginRatio: brand.tokens.logoSafeMargin ?? 0.04,
          bottomPanelPath,
          outroCardPath,
          outroDurationSeconds,
        };
      }
    }



    await reportProgress(cfg, job.id, "downloading_sources", 25);

    // --- Probe do áudio de entrada (antes do FFmpeg) --------------------
    stage = "probing_input";
    let inputReport;
    try {
      inputReport = await ffprobeInput(audioLocal, 15_000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("audio_input_probe_failed", { ...baseCtx, stage, message: msg.slice(0, 500) });
      throw new Error(`audio_input_invalid:${msg}`);
    }
    log.info("audio_input_probe", {
      ...baseCtx,
      stage,
      format_name: inputReport.formatName,
      format_long_name: inputReport.formatLongName,
      duration: inputReport.duration,
      size_bytes: inputReport.sizeBytes,
      overall_bit_rate: inputReport.overallBitRate,
      streams_total: inputReport.streamsTotal,
      audio_streams: inputReport.audioStreams,
      video_streams: inputReport.videoStreams,
      audio_codec_name: inputReport.audio?.codecName ?? null,
      audio_codec_long_name: inputReport.audio?.codecLongName ?? null,
      audio_codec_type: inputReport.audio?.codecType ?? null,
      audio_sample_rate: inputReport.audio?.sampleRate ?? null,
      audio_channels: inputReport.audio?.channels ?? null,
      audio_channel_layout: inputReport.audio?.channelLayout ?? null,
      audio_start_time: inputReport.audio?.startTime ?? null,
      audio_duration: inputReport.audio?.duration ?? null,
      audio_bit_rate: inputReport.audio?.bitRate ?? null,
      audio_disposition: inputReport.audio?.disposition ?? null,
      audio_tags: inputReport.audio?.tags ?? null,
    });
    if (!inputReport.audio || inputReport.audioStreams === 0) {
      throw new Error("audio_input_invalid:no_audio_stream");
    }

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

    const rangeCheck = validateAudioRange(
      audioStartSecond,
      durationSeconds,
      inputReport.audio?.duration ?? inputReport.duration,
    );
    log.info("audio_range_check", {
      ...baseCtx,
      stage,
      requested_start: rangeCheck.requestedStart,
      requested_duration: rangeCheck.requestedDuration,
      requested_end: rangeCheck.requestedEnd,
      actual_duration: rangeCheck.actualDuration,
      margin_seconds: rangeCheck.marginSeconds,
      ok: rangeCheck.ok,
      code: rangeCheck.code,
    });
    if (!rangeCheck.ok) {
      throw new Error(rangeCheck.code ?? "audio_range_out_of_bounds");
    }

    log.info("ffmpeg_pre_memory", { ...baseCtx, stage, ...memorySnapshot() });

    if (useSlideshow) {
      await renderSlideshowWithAudio({
        imageFilePaths: imageDownloads,
        focalPoints,
        audioFilePath: audioLocal,
        audioStartSecond,
        durationSeconds,
        width: job.width,
        height: job.height,
        outputFilePath: outputLocal,
        timeoutMs: cfg.ffmpegTimeoutMs,
        watermark,
        jobId: job.id,
        debugLogDir: workDir,
      });
    } else {
      await renderStaticImageVideo({
        imageFilePath: imageDownloads[0],
        audioFilePath: audioLocal,
        audioStartSecond,
        durationSeconds,
        width: job.width,
        height: job.height,
        outputFilePath: outputLocal,
        timeoutMs: cfg.ffmpegTimeoutMs,
        focalPoint: focalPoints[0] ?? null,
        watermark,
        jobId: job.id,
        debugLogDir: workDir,
      });
    }
    log.info("ffmpeg_post_memory", { ...baseCtx, stage, ...memorySnapshot() });
    await reportProgress(cfg, job.id, "rendering", 65);

    // 3. Validate
    stage = "validating";
    await reportProgress(cfg, job.id, "validating", 70);
    const probe = await ffprobe(outputLocal, 15_000);
    const volume = await analyzeVolume(outputLocal, 15_000);
    log.info("ffprobe_validation_completed", {
      ...baseCtx,
      stage,
      container: "mp4",
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
      has_audio_stream: !!probe.audioCodec,
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
    if (validationCode === "audio_stream_missing") {
      log.error("output_audio_missing", { ...baseCtx, stage });
    } else if (validationCode === "audio_stream_silent") {
      log.error("output_audio_silent", {
        ...baseCtx,
        stage,
        mean_volume_db: volume.meanVolumeDb,
        max_volume_db: volume.maxVolumeDb,
      });
    }
    if (validationCode) {
      throw new Error(validationCode);
    }

    // 4. Upload
    stage = "uploading";
    log.info("signed_video_upload_started", { ...baseCtx, stage });
    await reportProgress(cfg, job.id, "uploading", 85);
    const bytes = await readFile(outputLocal);
    await uploadSignedUrl(output.uploadUrl, bytes, "video/mp4", Math.max(cfg.httpTimeoutMs, 60_000));
    const size = (await stat(outputLocal)).size;
    log.info("signed_video_upload_completed", { ...baseCtx, stage, size_bytes: size });

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
      videoCodec: probe.videoCodec ?? "unknown",
      audioCodec: probe.audioCodec ?? "unknown",
      pixelFormat: probe.pixFmt ?? "yuv420p",
      mimeType: "video/mp4",
      renderElapsedMs: Date.now() - t0,
    });
    log.info("bridge_complete_confirmed", {
      ...baseCtx, stage, video_id: result.videoId, idempotent: !!result.idempotent,
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const message = sanitizeError(raw);
    const code = message.split(":")[0]?.slice(0, 80) ?? "unknown_error";
    log.error("render_failed", { ...baseCtx, stage, code });
    await reportFail(cfg, job.id, stage, code, message).catch(() => {});
    log.info("bridge_fail_confirmed", { ...baseCtx, stage, code });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    setActiveJobId(null);
  }
}

