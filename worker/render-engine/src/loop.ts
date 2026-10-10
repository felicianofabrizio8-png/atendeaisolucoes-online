// ============================================================================
// Laço principal do worker — o ÚNICO lugar que pede job à ponte.
//
// Separado do `index.ts` para ser testável sem subir o processo. A regra do
// modo pausado vive aqui, ANTES de qualquer chamada: com `cfg.paused` o laço
// nunca chega a `claimJob`, desde a primeira volta. Como `cfg` é lido das
// variáveis de ambiente a cada inicialização, o mesmo vale após reinícios.
// ============================================================================

import { RenderApiError, type ClaimedJob } from "./api-client.js";
import type { WorkerConfig } from "./config.js";
import { log } from "./logger.js";

export interface LoopDeps {
  claimJob: (cfg: WorkerConfig) => Promise<ClaimedJob | null>;
  processClaim: (cfg: WorkerConfig, claim: ClaimedJob) => Promise<void>;
  sleep: (ms: number) => Promise<unknown>;
  isStopping: () => boolean;
  now?: () => number;
}

const PAUSED_LOG_INTERVAL_MS = 60_000;

export async function runWorkerLoop(cfg: WorkerConfig, deps: LoopDeps): Promise<void> {
  const now = deps.now ?? Date.now;
  let lastPausedLog = -Infinity;
  while (!deps.isStopping()) {
    if (cfg.paused) {
      // Pausado: nenhuma chamada à ponte, nenhum job reservado.
      if (now() - lastPausedLog >= PAUSED_LOG_INTERVAL_MS) {
        lastPausedLog = now();
        log.info("worker_paused", {
          worker_id: cfg.workerId,
          reason: cfg.pausedReason,
          hint: "defina WORKER_PAUSED=false para processar a fila",
        });
      }
      await deps.sleep(cfg.pollIntervalMs);
      continue;
    }
    try {
      log.debug("bridge_claim_requested", { worker_id: cfg.workerId });
      const claim = await deps.claimJob(cfg);
      if (!claim) {
        await deps.sleep(cfg.pollIntervalMs);
        continue;
      }
      await deps.processClaim(cfg, claim);
    } catch (err) {
      if (err instanceof RenderApiError) {
        log.error("bridge_error", { status: err.status, code: err.code });
      } else {
        log.error("tick_exception", {
          message: err instanceof Error ? err.message.slice(0, 300) : "unknown",
        });
      }
      await deps.sleep(cfg.pollIntervalMs);
    }
  }
}
