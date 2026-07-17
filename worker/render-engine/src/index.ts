import { loadConfig } from "./config.js";
import { log, setLogLevel } from "./logger.js";
import { claimJob, RenderApiError } from "./api-client.js";
import { processClaim } from "./render.js";

async function main() {
  const cfg = loadConfig();
  setLogLevel(cfg.logLevel);

  log.info("worker_started", {
    worker_id: cfg.workerId,
    poll_interval_ms: cfg.pollIntervalMs,
    render_api_url_host: safeHost(cfg.renderApiUrl),
  });

  let stopping = false;
  const shutdown = (sig: string) => {
    if (stopping) return;
    stopping = true;
    log.info("worker_shutdown", { signal: sig });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  while (!stopping) {
    try {
      log.debug("bridge_claim_requested", { worker_id: cfg.workerId });
      const claim = await claimJob(cfg);
      if (!claim) {
        await sleep(cfg.pollIntervalMs);
        continue;
      }
      await processClaim(cfg, claim);
    } catch (err) {
      if (err instanceof RenderApiError) {
        log.error("bridge_error", { status: err.status, code: err.code });
      } else {
        log.error("tick_exception", {
          message: err instanceof Error ? err.message.slice(0, 300) : "unknown",
        });
      }
      await sleep(cfg.pollIntervalMs);
    }
  }

  log.info("worker_stopped", {});
  process.exit(0);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeHost(u: string): string {
  try { return new URL(u).host; } catch { return "invalid"; }
}

main().catch((e) => {
  process.stderr.write(JSON.stringify({
    ts: new Date().toISOString(), level: "error", event: "worker_fatal",
    message: e instanceof Error ? e.message.slice(0, 500) : "unknown",
  }) + "\n");
  process.exit(1);
});
