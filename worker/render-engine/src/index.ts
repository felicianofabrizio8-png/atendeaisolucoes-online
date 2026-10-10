import { loadConfig } from "./config.js";
import { log, setLogLevel } from "./logger.js";
import { claimJob } from "./api-client.js";
import { runWorkerLoop } from "./loop.js";
import { processClaim } from "./render.js";
import { getActiveJobId } from "./runtime-state.js";
import { SCENES } from "./scenes.js";


import { BUILD_SIGNATURE, BUILD_DATE, SCENE_COMPOSER_VERSION } from "./build-info.js";


async function main() {
  const cfg = loadConfig();
  setLogLevel(cfg.logLevel);

  // Prova estruturada de qual imagem está rodando. Deve aparecer no boot
  // do container Railway. Não contém segredos.
  log.info("render_build_signature", {
    build_signature: BUILD_SIGNATURE,
    build_date: BUILD_DATE,
    brand_composition_enabled: true,
    scene_engine_enabled: true,
    scene_composer_version: SCENE_COMPOSER_VERSION,
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
    paused: cfg.paused,
    paused_reason: cfg.pausedReason,
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

  if (cfg.pausedReason === "unrecognized_value") {
    log.warn("worker_paused_value_unrecognized", {
      hint: "WORKER_PAUSED aceita true/false; valor não reconhecido mantém o worker pausado",
    });
  }

  await runWorkerLoop(cfg, { claimJob, processClaim, sleep, isStopping: () => stopping });

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
