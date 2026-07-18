import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { log } from "./logger.js";
import { truncateStream } from "./telemetry.js";

export interface FocalPoint {
  x: number; // 0..1
  y: number; // 0..1
  zoom: number; // 1..3
}

export interface FfmpegRenderInput {
  imageFilePath: string;
  audioFilePath: string;
  audioStartSecond: number;
  durationSeconds: number;
  width: number;
  height: number;
  outputFilePath: string;
  timeoutMs: number;
  /** Opcional — quando ausente, aplica crop central (comportamento legado). */
  focalPoint?: FocalPoint | null;
  /** Observabilidade — não altera parâmetros do FFmpeg. */
  jobId?: string;
  /** Observabilidade — quando definido, persiste ffmpeg.stderr.log/stdout.log
   *  no diretório informado (removido pelo caller junto com o workDir). */
  debugLogDir?: string;
}

/**
 * Renderiza imagem estática + trecho de áudio em MP4 H.264/AAC.
 *
 * Fallback (sem focalPoint): comportamento legado bit-a-bit — scale para
 * cobrir W×H + crop central + yuv420p.
 *
 * Com focalPoint: aplica scale multiplicado por zoom e crop deslocado para
 * manter (x,y) da imagem original o mais próximo possível do centro.
 */
export async function renderStaticImageVideo(input: FfmpegRenderInput): Promise<void> {
  const {
    imageFilePath,
    audioFilePath,
    audioStartSecond,
    durationSeconds,
    width,
    height,
    outputFilePath,
    timeoutMs,
    focalPoint,
  } = input;

  const vf = focalPoint
    ? buildFocalVideoFilter(width, height, focalPoint)
    : `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
      `crop=${width}:${height},` +
      `setsar=1,` +
      `setparams=range=tv,` +
      `format=yuv420p`;

  const args = [
    "-y",
    "-loop", "1", "-framerate", "30", "-i", imageFilePath,
    "-ss", String(audioStartSecond), "-t", String(durationSeconds), "-i", audioFilePath,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-vf", vf,
    "-c:v", "libx264",
    "-profile:v", "high",
    "-preset", "medium",
    "-crf", "20",
    "-r", "30",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-profile:a", "aac_low", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    "-t", String(durationSeconds),
    outputFilePath,
  ];

  await runFfmpeg({
    args,
    timeoutMs,
    sanitizePaths: { imageFilePath, audioFilePath, outputFilePath },
    width, height, audioStartSecond, durationSeconds,
    jobId: input.jobId,
    debugLogDir: input.debugLogDir,
  });
}

/**
 * Renderiza N imagens (1..8) como slideshow com transição xfade + trecho de
 * áudio. Divide `durationSeconds` igualmente entre as imagens. Cada imagem
 * pode ter seu próprio focal point.
 */
export interface SlideshowInput {
  imageFilePaths: string[]; // ordem = ordem do slideshow
  focalPoints: Array<FocalPoint | null>; // paralelo a imageFilePaths
  audioFilePath: string;
  audioStartSecond: number;
  durationSeconds: number;
  width: number;
  height: number;
  outputFilePath: string;
  timeoutMs: number;
}

export async function renderSlideshowWithAudio(input: SlideshowInput): Promise<void> {
  const {
    imageFilePaths,
    focalPoints,
    audioFilePath,
    audioStartSecond,
    durationSeconds,
    width,
    height,
    outputFilePath,
    timeoutMs,
  } = input;

  const n = imageFilePaths.length;
  if (n === 0) throw new Error("slideshow_no_images");
  if (n === 1) {
    // Fallback: 1 imagem → pipeline single (com focal opcional).
    await renderStaticImageVideo({
      imageFilePath: imageFilePaths[0],
      audioFilePath,
      audioStartSecond,
      durationSeconds,
      width,
      height,
      outputFilePath,
      timeoutMs,
      focalPoint: focalPoints[0] ?? null,
    });
    return;
  }

  const perSlot = durationSeconds / n;
  const xfadeDuration = Math.min(0.6, perSlot / 3); // ~0.5s ou menos

  // Cada input roda com -loop 1 -t perSlot (para não terminar antes da hora).
  const args: string[] = ["-y"];
  for (let i = 0; i < n; i++) {
    args.push("-loop", "1", "-t", perSlot.toFixed(3), "-framerate", "30", "-i", imageFilePaths[i]);
  }
  args.push("-ss", String(audioStartSecond), "-t", String(durationSeconds), "-i", audioFilePath);

  // filter_complex: aplica scale+crop (com focal) em cada input, depois xfade em cadeia
  const filterParts: string[] = [];
  for (let i = 0; i < n; i++) {
    const vf = focalPoints[i]
      ? buildFocalVideoFilter(width, height, focalPoints[i]!)
      : `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
        `crop=${width}:${height},` +
        `setsar=1,setparams=range=tv,format=yuv420p`;
    filterParts.push(`[${i}:v]${vf}[v${i}]`);
  }
  // Chain: v0 xfade v1 -> vx1; vx1 xfade v2 -> vx2; ...
  let lastLabel = "v0";
  for (let i = 1; i < n; i++) {
    const offset = perSlot * i - xfadeDuration;
    const nextLabel = i === n - 1 ? "vout" : `vx${i}`;
    filterParts.push(
      `[${lastLabel}][v${i}]xfade=transition=fade:duration=${xfadeDuration.toFixed(
        3,
      )}:offset=${offset.toFixed(3)}[${nextLabel}]`,
    );
    lastLabel = nextLabel;
  }

  const filterComplex = filterParts.join(";");

  args.push(
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", `${n}:a:0`,
    "-c:v", "libx264",
    "-profile:v", "high",
    "-preset", "medium",
    "-crf", "20",
    "-r", "30",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-profile:a", "aac_low", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    "-t", String(durationSeconds),
    outputFilePath,
  );

  await runFfmpeg({
    args,
    timeoutMs,
    sanitizePaths: {
      imageFilePath: imageFilePaths[0],
      audioFilePath,
      outputFilePath,
    },
    slideshowExtraPaths: imageFilePaths.slice(1),
    width, height, audioStartSecond, durationSeconds,
    slideshow: n,
  });
}

// -----------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------

/**
 * Constrói o filtro de vídeo para um focal point.
 * Passo 1: escala mantendo aspect ratio para cobrir W×H, aplicando zoom.
 *          Isso garante que a imagem NÃO fica menor do que o quadro.
 * Passo 2: crop W×H deslocado pelo (x,y) do focal.
 * Passo 3: setsar/format padrão.
 */
export function buildFocalVideoFilter(
  width: number,
  height: number,
  focal: FocalPoint,
): string {
  const zoom = Math.max(1, Math.min(3, Number(focal.zoom) || 1));
  const x = Math.max(0, Math.min(1, Number(focal.x)));
  const y = Math.max(0, Math.min(1, Number(focal.y)));

  // "increase" garante cobrir W×H mesmo antes do zoom.
  // Depois multiplicamos por `zoom` para permitir ampliar além do fit.
  const scaledW = `iw*max(${width}/iw\\,${height}/ih)*${zoom.toFixed(4)}`;
  const scaledH = `ih*max(${width}/iw\\,${height}/ih)*${zoom.toFixed(4)}`;

  // offset em coordenadas do quadro escalado; clamp entre 0 e (scaled - crop).
  // Vírgulas dentro de clip(...) precisam ser escapadas dentro de filter_complex
  // — caso contrário o parser as trata como separador de filtros.
  const cropX = `clip(${x.toFixed(4)}*iw - ${width}/2\\, 0\\, iw - ${width})`;
  const cropY = `clip(${y.toFixed(4)}*ih - ${height}/2\\, 0\\, ih - ${height})`;

  return (
    `scale=w=${scaledW}:h=${scaledH}:flags=lanczos,` +
    `crop=${width}:${height}:${cropX}:${cropY},` +
    `setsar=1,setparams=range=tv,format=yuv420p`
  );
}

interface RunOpts {
  args: string[];
  timeoutMs: number;
  sanitizePaths: { imageFilePath: string; audioFilePath: string; outputFilePath: string };
  slideshowExtraPaths?: string[];
  width: number;
  height: number;
  audioStartSecond: number;
  durationSeconds: number;
  slideshow?: number;
}

async function runFfmpeg(opts: RunOpts): Promise<void> {
  const { args, timeoutMs } = opts;
  await new Promise<void>((resolve, reject) => {
    log.info("ffmpeg_started", {
      width: opts.width,
      height: opts.height,
      audioStartSecond: opts.audioStartSecond,
      durationSeconds: opts.durationSeconds,
      slideshow: opts.slideshow ?? 1,
      args: sanitizeFfmpegArgs(args, opts.sanitizePaths, opts.slideshowExtraPaths ?? []),
    });
    const started = Date.now();
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderrTail = "";
    p.stderr.on("data", (d) => {
      const s = d.toString();
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

function sanitizeFfmpegArgs(
  args: string[],
  paths: { imageFilePath: string; audioFilePath: string; outputFilePath: string },
  extras: string[],
): string[] {
  return args.map((arg) => {
    if (arg === paths.imageFilePath) return "[image_file_0]";
    if (arg === paths.audioFilePath) return "[audio_file]";
    if (arg === paths.outputFilePath) return "[output_file]";
    const idx = extras.indexOf(arg);
    if (idx >= 0) return `[image_file_${idx + 1}]`;
    return arg;
  });
}
