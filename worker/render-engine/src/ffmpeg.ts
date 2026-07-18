import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
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
  /** Observabilidade — não altera parâmetros do FFmpeg. */
  jobId?: string;
  debugLogDir?: string;
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
      jobId: input.jobId,
      debugLogDir: input.debugLogDir,
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
    jobId: input.jobId,
    debugLogDir: input.debugLogDir,
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
  jobId?: string;
  debugLogDir?: string;
}

/**
 * Executa o ffmpeg preservando 100% dos argumentos. Só adiciona
 * observabilidade: PID, exit code, signal, timeout, memória de stderr/stdout.
 *
 * Erros são classificados em códigos distintos:
 *  - ffmpeg_timeout                       → worker matou o processo por atingir timeoutMs
 *  - ffmpeg_killed_by_worker_<SIG>        → worker enviou sinal fora do fluxo de timeout
 *                                            (defensivo — hoje não há outro caminho)
 *  - ffmpeg_killed_external_<SIG>         → processo encerrado por sinal externo
 *                                            (OOM killer da plataforma, orquestrador,
 *                                            operador enviando kill, SIGSEGV, ...).
 *                                            Em ambientes containerizados (Railway,
 *                                            Kubernetes) SIGKILL sem timeout costuma
 *                                            ser cgroup OOM (memória excedida).
 *  - ffmpeg_exit_<code>                   → processo encerrou com code != 0 e sem signal
 *  - spawn_error:<msg>                    → falha ao criar o processo
 */
async function runFfmpeg(opts: RunOpts): Promise<void> {
  const { args, timeoutMs, jobId, debugLogDir } = opts;
  const sanitizedArgs = sanitizeFfmpegArgs(args, opts.sanitizePaths, opts.slideshowExtraPaths ?? []);

  await new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const startedIso = new Date(startedAt).toISOString();
    const env = { ...process.env, AV_LOG_FORCE_NOCOLOR: "1" };
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"], env });
    const pid = p.pid ?? -1;

    log.info("ffmpeg_started", {
      job_id: jobId,
      pid,
      started_at: startedIso,
      timeout_ms: timeoutMs,
      width: opts.width,
      height: opts.height,
      audio_start_second: opts.audioStartSecond,
      duration_seconds: opts.durationSeconds,
      slideshow: opts.slideshow ?? 1,
      args_count: args.length,
      args: sanitizedArgs,
    });

    let stderrFull = "";
    let stdoutFull = "";
    const MAX_CAPTURE = 32 * 1024;
    p.stderr.on("data", (d) => {
      if (stderrFull.length < MAX_CAPTURE * 4) stderrFull += d.toString();
    });
    p.stdout.on("data", (d) => {
      if (stdoutFull.length < MAX_CAPTURE) stdoutFull += d.toString();
    });

    let timeoutTriggered = false;
    let killRequestedByWorker = false;
    const to = setTimeout(() => {
      timeoutTriggered = true;
      killRequestedByWorker = true;
      log.warn("ffmpeg_timeout_kill_requested", {
        job_id: jobId,
        pid,
        timeout_ms: timeoutMs,
        elapsed_ms: Date.now() - startedAt,
      });
      try { p.kill("SIGKILL"); } catch { /* noop */ }
    }, timeoutMs);

    let spawnFailed = false;
    p.on("error", (e) => {
      spawnFailed = true;
      clearTimeout(to);
      log.error("ffmpeg_spawn_error", {
        job_id: jobId,
        pid,
        message: (e instanceof Error ? e.message : String(e)).slice(0, 300),
      });
      reject(new Error(`spawn_error:${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`));
    });

    p.on("exit", (code, signal) => {
      log.debug("ffmpeg_process_exit", {
        job_id: jobId,
        pid,
        code,
        signal,
        elapsed_ms: Date.now() - startedAt,
        timeout_triggered: timeoutTriggered,
        kill_requested_by_worker: killRequestedByWorker,
      });
    });

    p.on("close", (code, signal) => {
      if (spawnFailed) return;
      clearTimeout(to);
      const elapsed_ms = Date.now() - startedAt;
      const stderrTrunc = truncateStream(stderrFull);
      const stdoutTrunc = truncateStream(stdoutFull);

      const kill_origin: "worker" | "external" | "none" =
        signal ? (killRequestedByWorker ? "worker" : "external") : "none";

      log.info("ffmpeg_process_close", {
        job_id: jobId,
        pid,
        code,
        signal,
        elapsed_ms,
        timeout_triggered: timeoutTriggered,
        kill_requested_by_worker: killRequestedByWorker,
        kill_origin,
        stderr_total_bytes: stderrTrunc.totalBytes,
        stdout_total_bytes: stdoutTrunc.totalBytes,
      });

      if (debugLogDir) {
        writeFile(path.join(debugLogDir, "ffmpeg.stderr.log"), stderrFull).catch(() => {});
        writeFile(path.join(debugLogDir, "ffmpeg.stdout.log"), stdoutFull).catch(() => {});
      }

      const failed = code !== 0 || (signal !== null && signal !== undefined);
      if (failed) {
        const classified = classifyFfmpegFailure({
          code,
          signal,
          timeoutTriggered,
          killRequestedByWorker,
        });

        // Persist stderr COMPLETO em diretório fora do workDir (que será limpo
        // pelo caller). Permite inspecionar após a falha, mesmo depois do
        // finally do render.ts remover o workDir do job.
        (async () => {
          const persistDir = path.join(os.tmpdir(), "ffmpeg-failures", `${jobId ?? "no-job"}-${randomUUID().slice(0, 8)}`);
          let stderrPath: string | null = null;
          let stdoutPath: string | null = null;
          try {
            await mkdir(persistDir, { recursive: true });
            stderrPath = path.join(persistDir, "ffmpeg.stderr.log");
            stdoutPath = path.join(persistDir, "ffmpeg.stdout.log");
            await writeFile(stderrPath, stderrFull);
            await writeFile(stdoutPath, stdoutFull);
            log.error("ffmpeg_stderr_persisted", {
              job_id: jobId,
              pid,
              persist_dir: persistDir,
              stderr_path: stderrPath,
              stdout_path: stdoutPath,
              stderr_total_bytes: stderrTrunc.totalBytes,
              stdout_total_bytes: stdoutTrunc.totalBytes,
            });
          } catch (persistErr) {
            log.error("ffmpeg_stderr_persist_failed", {
              job_id: jobId,
              pid,
              persist_dir: persistDir,
              message: (persistErr instanceof Error ? persistErr.message : String(persistErr)).slice(0, 300),
            });
          }

          log.error("ffmpeg_failed", {
            job_id: jobId,
            pid,
            code,
            signal,
            elapsed_ms,
            classified,
            kill_origin,
            timeout_triggered: timeoutTriggered,
            kill_requested_by_worker: killRequestedByWorker,
            stderr_total_bytes: stderrTrunc.totalBytes,
            stderr_head: stderrTrunc.head,
            stderr_tail: stderrTrunc.tail,
            stderr_truncated: stderrTrunc.truncated,
            stdout_head: stdoutTrunc.head.slice(0, 512),
            stderr_full_path: stderrPath,
            stdout_full_path: stdoutPath,
          });

          // Reexecução isolada — mesmos args, mesmos arquivos de entrada
          // (ainda presentes; workDir só é limpo no finally do render.ts após
          // o reject deste Promise). Objetivo: distinguir uma falha
          // determinística (bug/args/entrada) de uma condição ambiental
          // (OOM/limite de CPU/sinal externo intermitente).
          try {
            const isolated = await runFfmpegIsolated({
              args,
              timeoutMs,
              jobId,
              persistDir,
              originalPid: pid,
            });
            log.error("ffmpeg_isolated_rerun_result", {
              job_id: jobId,
              original_pid: pid,
              ...isolated,
            });
          } catch (rerunErr) {
            log.error("ffmpeg_isolated_rerun_error", {
              job_id: jobId,
              original_pid: pid,
              message: (rerunErr instanceof Error ? rerunErr.message : String(rerunErr)).slice(0, 300),
            });
          }

          reject(new Error(classified));
        })();
      } else {
        log.info("ffmpeg_completed", { job_id: jobId, pid, elapsed_ms });
        resolve();
      }
    });
  });
}

/**
 * Reexecuta o mesmo comando ffmpeg (args idênticos) em um processo isolado,
 * fora do pipeline de render. Grava stderr/stdout completos em disco.
 * Retorna metadados do resultado (não lança em falha do ffmpeg — só lança
 * em erro de spawn).
 */
export interface IsolatedRerunResult {
  outcome: "success" | "failed";
  code: number | null;
  signal: NodeJS.Signals | string | null;
  classified: string | null;
  elapsed_ms: number;
  timeout_triggered: boolean;
  stderr_total_bytes: number;
  stdout_total_bytes: number;
  stderr_head: string;
  stderr_tail: string;
  stderr_truncated: boolean;
  stderr_path: string | null;
  stdout_path: string | null;
  isolated_pid: number;
}

async function runFfmpegIsolated(input: {
  args: string[];
  timeoutMs: number;
  jobId?: string;
  persistDir: string;
  originalPid: number;
}): Promise<IsolatedRerunResult> {
  const { args, timeoutMs, jobId, persistDir, originalPid } = input;
  log.error("ffmpeg_isolated_rerun_started", {
    job_id: jobId,
    original_pid: originalPid,
    timeout_ms: timeoutMs,
    args_count: args.length,
  });

  return await new Promise<IsolatedRerunResult>((resolve, reject) => {
    const startedAt = Date.now();
    const env = { ...process.env, AV_LOG_FORCE_NOCOLOR: "1" };
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"], env });
    const isoPid = p.pid ?? -1;

    let stderrFull = "";
    let stdoutFull = "";
    p.stderr.on("data", (d) => { stderrFull += d.toString(); });
    p.stdout.on("data", (d) => { stdoutFull += d.toString(); });

    let timeoutTriggered = false;
    const to = setTimeout(() => {
      timeoutTriggered = true;
      try { p.kill("SIGKILL"); } catch { /* noop */ }
    }, timeoutMs);

    let spawnFailed = false;
    p.on("error", (e) => {
      spawnFailed = true;
      clearTimeout(to);
      reject(e instanceof Error ? e : new Error(String(e)));
    });

    p.on("close", async (code, signal) => {
      if (spawnFailed) return;
      clearTimeout(to);
      const elapsed_ms = Date.now() - startedAt;
      const stderrTrunc = truncateStream(stderrFull);
      const stdoutTrunc = truncateStream(stdoutFull);

      let stderrPath: string | null = null;
      let stdoutPath: string | null = null;
      try {
        stderrPath = path.join(persistDir, "ffmpeg.isolated.stderr.log");
        stdoutPath = path.join(persistDir, "ffmpeg.isolated.stdout.log");
        await writeFile(stderrPath, stderrFull);
        await writeFile(stdoutPath, stdoutFull);
      } catch {
        stderrPath = null;
        stdoutPath = null;
      }

      const failed = code !== 0 || (signal !== null && signal !== undefined);
      const classified = failed
        ? classifyFfmpegFailure({ code, signal, timeoutTriggered, killRequestedByWorker: timeoutTriggered })
        : null;

      resolve({
        outcome: failed ? "failed" : "success",
        code,
        signal,
        classified,
        elapsed_ms,
        timeout_triggered: timeoutTriggered,
        stderr_total_bytes: stderrTrunc.totalBytes,
        stdout_total_bytes: stdoutTrunc.totalBytes,
        stderr_head: stderrTrunc.head,
        stderr_tail: stderrTrunc.tail,
        stderr_truncated: stderrTrunc.truncated,
        stderr_path: stderrPath,
        stdout_path: stdoutPath,
        isolated_pid: isoPid,
      });
    });
  });
}
  });
}

/**
 * Classifica a causa de falha do ffmpeg em um código estável.
 *
 * A distinção entre kill interno (worker) e kill externo (plataforma/OOM/operador)
 * é feita através do flag `killRequestedByWorker`, que só é `true` quando o próprio
 * worker chama `p.kill(...)`. Se um sinal chegar ao processo sem que o worker
 * tenha pedido, a origem é necessariamente externa.
 */
export function classifyFfmpegFailure(input: {
  code: number | null;
  signal: NodeJS.Signals | string | null;
  timeoutTriggered: boolean;
  killRequestedByWorker?: boolean;
}): string {
  if (input.timeoutTriggered) return "ffmpeg_timeout";
  if (input.signal) {
    return input.killRequestedByWorker
      ? `ffmpeg_killed_by_worker_${input.signal}`
      : `ffmpeg_killed_external_${input.signal}`;
  }
  if (input.code !== null && input.code !== undefined) return `ffmpeg_exit_${input.code}`;
  return "ffmpeg_exit_null";
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
