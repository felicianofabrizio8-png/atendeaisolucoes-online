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
  };
}
