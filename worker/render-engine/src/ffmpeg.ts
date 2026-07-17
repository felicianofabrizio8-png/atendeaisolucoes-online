import { spawn } from "node:child_process";
import { log } from "./logger.js";

export interface FfmpegRenderInput {
  imageFilePath: string;
  audioFilePath: string;
  audioStartSecond: number;
  durationSeconds: number;
  width: number;
  height: number;
  outputFilePath: string;
  timeoutMs: number;
}

/**
 * Renderiza imagem estática + trecho de áudio em MP4 H.264/AAC.
 * Imagem preenche o quadro sem deformar (cover: scale + crop centralizado).
 * Nenhum texto, logo, animação ou transição.
 */
export async function renderStaticImageVideo(input: FfmpegRenderInput): Promise<void> {
  const { imageFilePath, audioFilePath, audioStartSecond, durationSeconds,
          width, height, outputFilePath, timeoutMs } = input;

  const vf =
    `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},` +
    `format=yuv420p`;

  const args = [
    "-y",
    "-loop", "1", "-framerate", "30", "-i", imageFilePath,
    "-ss", String(audioStartSecond), "-t", String(durationSeconds), "-i", audioFilePath,
    "-vf", vf,
    "-c:v", "libx264",
    "-profile:v", "high",
    "-preset", "medium",
    "-crf", "20",
    "-r", "30",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-shortest",
    "-movflags", "+faststart",
    "-t", String(durationSeconds),
    outputFilePath,
  ];

  await new Promise<void>((resolve, reject) => {
    log.info("ffmpeg_started", { width, height, durationSeconds });
    const started = Date.now();
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderrTail = "";
    p.stderr.on("data", (d) => {
      const s = d.toString();
      // Retém apenas a cauda para diagnóstico em caso de erro
      stderrTail = (stderrTail + s).slice(-2000);
    });
    const to = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("ffmpeg_timeout"));
    }, timeoutMs);
    p.on("error", (e) => { clearTimeout(to); reject(e); });
    p.on("close", (code) => {
      clearTimeout(to);
      const elapsed_ms = Date.now() - started;
      if (code !== 0) {
        log.error("ffmpeg_failed", { code, elapsed_ms, tail: stderrTail.slice(-500) });
        reject(new Error(`ffmpeg_exit_${code}`));
      } else {
        log.info("ffmpeg_completed", { elapsed_ms });
        resolve();
      }
    });
  });
}
