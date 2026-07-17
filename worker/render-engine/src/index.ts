import { loadConfig } from "./config.js";
import { createAdmin } from "./supabase.js";
import { log, setLogLevel } from "./logger.js";
import { processJob, markFailed } from "./render.js";

async function main() {
  const cfg = loadConfig();
  setLogLevel(cfg.logLevel);
  const admin = createAdmin(cfg);

  log.info("worker_started", {
    worker_id: cfg.workerId,
    poll_interval_ms: cfg.pollIntervalMs,
    lock_seconds: cfg.lockSeconds,
  });

  let stopping = false;
  const shutdown = (sig: string) => {
    if (stopping) return;
    stopping = true;
    log.info("worker_shutdown", { signal: sig });
    // Deixa o loop encerrar naturalmente
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  while (!stopping) {
    try {
      const { data, error } = await admin.rpc("claim_render_job", {
        _worker_id: cfg.workerId,
        _lock_seconds: cfg.lockSeconds,
      });
      if (error) {
        log.error("claim_failed", { error_code: error.code ?? null });
        await sleep(cfg.pollIntervalMs);
        continue;
      }
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      if (rows.length === 0) {
        await sleep(cfg.pollIntervalMs);
        continue;
      }
      const job = rows[0] as unknown as Parameters<typeof processJob>[2];
      log.info("render_job_claimed", {
        job_id: job.id,
        company_id: job.company_id,
        video_format: job.video_format,
        duration_seconds: job.duration_seconds,
        attempt: job.attempt_count,
      });
      try {
        await processJob(admin, cfg, job);
      } catch (err) {
        await markFailed(admin, job, err);
      }
    } catch (err) {
      log.error("tick_exception", { message: err instanceof Error ? err.message.slice(0, 300) : "unknown" });
      await sleep(cfg.pollIntervalMs);
    }
  }

  log.info("worker_stopped", {});
  process.exit(0);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  process.stderr.write(JSON.stringify({
    ts: new Date().toISOString(), level: "error", event: "worker_fatal",
    message: e instanceof Error ? e.message.slice(0, 500) : "unknown",
  }) + "\n");
  process.exit(1);
});
