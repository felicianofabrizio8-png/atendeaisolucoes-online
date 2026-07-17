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
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  workerId: string;
  pollIntervalMs: number;
  lockSeconds: number;
  ffmpegTimeoutMs: number;
  tmpDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

export function loadConfig(): WorkerConfig {
  const level = (process.env.LOG_LEVEL ?? "info") as WorkerConfig["logLevel"];
  return {
    supabaseUrl: requireEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    workerId: process.env.WORKER_ID ?? `render-worker-${process.pid}`,
    pollIntervalMs: optionalNumber("POLL_INTERVAL_SECONDS", 5) * 1000,
    lockSeconds: optionalNumber("LOCK_SECONDS", 600),
    ffmpegTimeoutMs: optionalNumber("FFMPEG_TIMEOUT_SECONDS", 300) * 1000,
    tmpDir: process.env.TMP_DIR ?? "/tmp/render",
    logLevel: ["debug", "info", "warn", "error"].includes(level) ? level : "info",
  };
}
