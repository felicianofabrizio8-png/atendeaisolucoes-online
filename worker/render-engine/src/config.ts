function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new Error(`missing_env:${name}`);
  return v;
}

function optionalNumber(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface WorkerConfig {
  renderApiUrl: string;
  renderWorkerSecret: string;
  workerId: string;
  pollIntervalMs: number;
  ffmpegTimeoutMs: number;
  tmpDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
  httpTimeoutMs: number;
  /**
   * WORKER_PAUSED=true: o worker sobe, prova o build nos logs e fica ocioso,
   * SEM pegar jobs. Serve para validar um deploy e revisar a fila antes de
   * liberar o processamento.
   */
  paused: boolean;
  /** Por que está pausado: pedido explícito ou valor que não deu para entender. */
  pausedReason: "requested" | "unrecognized_value" | null;
}

/**
 * Interpreta WORKER_PAUSED. Falha FECHADO: só um "não" explícito (ou a
 * variável ausente/vazia) libera a fila. Um valor digitado errado — "ture",
 * "sim", "pausado" — mantém o worker pausado, em vez de liberar por engano.
 */
export function parsePaused(raw: string | undefined): Pick<WorkerConfig, "paused" | "pausedReason"> {
  const value = (raw ?? "").trim().replace(/^["']|["']$/g, "").trim().toLowerCase();
  if (value === "" || ["false", "0", "no", "off"].includes(value)) return { paused: false, pausedReason: null };
  if (["true", "1", "yes", "on"].includes(value)) return { paused: true, pausedReason: "requested" };
  return { paused: true, pausedReason: "unrecognized_value" };
}

export function loadConfig(): WorkerConfig {
  const level = (process.env.LOG_LEVEL ?? "info") as WorkerConfig["logLevel"];
  const url = requireEnv("RENDER_API_URL").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) throw new Error("invalid_env:RENDER_API_URL");
  const secret = requireEnv("RENDER_WORKER_SECRET");
  if (secret.length < 24) throw new Error("invalid_env:RENDER_WORKER_SECRET_too_short");
  return {
    renderApiUrl: url,
    renderWorkerSecret: secret,
    workerId: process.env.WORKER_ID ?? `render-worker-${process.pid}`,
    pollIntervalMs: optionalNumber("POLL_INTERVAL_SECONDS", 5) * 1000,
    ffmpegTimeoutMs: optionalNumber("FFMPEG_TIMEOUT_SECONDS", 300) * 1000,
    tmpDir: process.env.TMP_DIR ?? "/tmp/render",
    logLevel: ["debug", "info", "warn", "error"].includes(level) ? level : "info",
    httpTimeoutMs: optionalNumber("HTTP_TIMEOUT_SECONDS", 30) * 1000,
    ...parsePaused(process.env.WORKER_PAUSED),
  };
}
