import { loadConfig } from "./config.js";
import { log, setLogLevel } from "./logger.js";
import { claimJob, RenderApiError } from "./api-client.js";
import { processClaim } from "./render.js";
import { getActiveJobId } from "./runtime-state.js";
import { SCENES } from "./scenes.js";


const BUILD_SIGNATURE = "render-scene-svg-escape-build-003";
const BUILD_TIMESTAMP = "2026-07-20";


async function main() {
  const cfg = loadConfig();
  setLogLevel(cfg.logLevel);

  // Prova estruturada de qual imagem está rodando. Deve aparecer no boot
  // do container Railway. Não contém segredos.
  log.info("render_build_signature", {
    build_signature: BUILD_SIGNATURE,
    build_date: BUILD_TIMESTAMP,
    brand_composition_enabled: true,
    scene_engine_enabled: true,
    scene_composer_version: "scene-v1",
    available_scene_ids: Object.keys(SCENES),
    entrypoint: "dist/index.js",
    node_version: process.version,
    pid: process.pid,
  });


  log.info("worker_started", {
    worker_id: cfg.workerId,
    pid: process.pid,
    poll_interval_ms: cfg.pollIntervalMs,
    render_api_url_host: safeHost(cfg.renderApiUrl),
    build_signature: BUILD_SIGNATURE,
  });


  let stopping = false;
  const shutdown = (sig: string) => {
    if (stopping) return;
    stopping = true;
    log.info("worker_signal_received", {
      signal: sig,
      pid: process.pid,
      uptime_seconds: Math.round(process.uptime()),
      active_job_id: getActiveJobId(),
    });
    log.info("worker_shutdown", { signal: sig });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  process.on("uncaughtException", (err) => {
    log.error("worker_uncaught_exception", {
      pid: process.pid,
      uptime_seconds: Math.round(process.uptime()),
      active_job_id: getActiveJobId(),
      message: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      stack: err instanceof Error && err.stack ? err.stack.slice(0, 1000) : null,
    });
  });
  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    log.error("worker_unhandled_rejection", {
      pid: process.pid,
      uptime_seconds: Math.round(process.uptime()),
      active_job_id: getActiveJobId(),
      message: msg.slice(0, 500),
    });
  });

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
