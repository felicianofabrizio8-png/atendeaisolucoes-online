// ============================================================================
// RuntimeWorker — Worker genérico do Runtime.
// NÃO conhece agentes. Só conhece: JobQueue + ExecutionEngine.
// Etapa 5: sem loops, sem polling. Somente `process(jobId)` sob demanda.
// ============================================================================

import type { RuntimeExecutionEngine } from "./RuntimeExecutionEngine.server";
import type { RuntimeJobQueue } from "./RuntimeJobQueue.server";
import { RuntimeClock } from "./RuntimeClock.server";
import { WorkerHealth, type WorkerHealthSnapshot } from "./WorkerHealth.server";
import { WorkerHeartbeat, type WorkerHeartbeatTick } from "./WorkerHeartbeat.server";
import { WorkerMetrics, type WorkerMetricsSnapshot } from "./WorkerMetrics.server";
import type { PipelineRunReport } from "./ExecutionPipeline.server";
import type { LearningLoop, LearningCycleReport } from "./LearningLoop.server";

/** Etapa 7: worker executa system-health + agentes de inteligência. */
const WORKER_ALLOWLIST: ReadonlySet<string> = new Set([
  "system-health",
  "business-brain",
  "business-learning",
  "scientific-knowledge",
  "scientific-memory",
  "professor",
  "executive-intelligence",
  "executive-knowledge",
  "executive-narrative",
]);

export interface WorkerDeps {
  workerId: string;
  queue: RuntimeJobQueue | null;
  engine: RuntimeExecutionEngine;
}

export interface WorkerProcessResult {
  workerId: string;
  jobId: string;
  found: boolean;
  ok: boolean;
  reason: string;
  report: PipelineRunReport | null;
  processingMs: number;
  learning: LearningCycleReport | null;
}

export class RuntimeWorker {
  readonly workerId: string;
  readonly startedAtMs: number;
  readonly startedAtIso: string;
  readonly health: WorkerHealth;
  readonly metrics = new WorkerMetrics();
  readonly heartbeat: WorkerHeartbeat;

  private queue: RuntimeJobQueue | null;
  private readonly engine: RuntimeExecutionEngine;
  private learningLoop: LearningLoop | null = null;

  constructor(deps: WorkerDeps) {
    this.workerId = deps.workerId;
    this.startedAtMs = RuntimeClock.now();
    this.startedAtIso = new Date(this.startedAtMs).toISOString();
    this.health = new WorkerHealth(this.startedAtMs);
    this.heartbeat = new WorkerHeartbeat(this.health);
    this.queue = deps.queue;
    this.engine = deps.engine;
    this.heartbeat.tick();
  }

  bindQueue(queue: RuntimeJobQueue | null): void {
    this.queue = queue;
  }

  bindLearningLoop(loop: LearningLoop | null): void {
    this.learningLoop = loop;
  }

  /**
   * Processa um job por ID. Não faz polling, não reserva automaticamente.
   * Nesta etapa: sem consumo automático — chamada explícita apenas.
   */
  async process(jobId: string): Promise<WorkerProcessResult> {
    const started = RuntimeClock.now();

    if (!this.queue) {
      return {
        workerId: this.workerId,
        jobId,
        found: false,
        ok: false,
        reason: "queue_not_bound",
        report: null,
        processingMs: 0,
        learning: null,
      };
    }

    const job = await this.queue.find(jobId).catch(() => null);
    if (!job) {
      return {
        workerId: this.workerId,
        jobId,
        found: false,
        ok: false,
        reason: "job_not_found",
        report: null,
        processingMs: RuntimeClock.now() - started,
        learning: null,
      };
    }

    // Etapa 6: apenas system-health é permitido. Outros permanecem em queue.
    if (!WORKER_ALLOWLIST.has(job.agentId)) {
      return {
        workerId: this.workerId,
        jobId,
        found: true,
        ok: false,
        reason: `agent_not_enabled:${job.agentId}`,
        report: null,
        processingMs: RuntimeClock.now() - started,
        learning: null,
      };
    }

    // ---- Reserva atômica (persistente) ANTES de executar ------------------
    // Idempotência: repetidas chamadas com o mesmo jobId retornam sem executar.
    let claimReason = "claimed";
    try {
      const claim = await this.queue.claim(jobId, this.workerId, 300);
      claimReason = claim.reason;
      if (!claim.claimed) {
        return {
          workerId: this.workerId,
          jobId,
          found: true,
          ok: claim.reason === "already_completed",
          reason: claim.reason,
          report: null,
          processingMs: RuntimeClock.now() - started,
          learning: null,
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "claim_failed";
      return {
        workerId: this.workerId,
        jobId,
        found: true,
        ok: false,
        reason: `claim_error:${msg.slice(0, 80)}`,
        report: null,
        processingMs: RuntimeClock.now() - started,
        learning: null,
      };
    }
    void claimReason;

    this.health.markStart(jobId);
    let report: PipelineRunReport | null = null;
    let err: string | null = null;
    try {
      report = await this.engine.execute(job);
    } catch (e) {
      err = e instanceof Error ? e.message : "worker_error";
    }

    // ---- Persistência do resultado (SEMPRE, mesmo em erro) ----------------
    // Sanitizado: apenas código técnico + duração; jamais payload/PII.
    if (err !== null || !report) {
      const safeErr = (err ?? "no_report").slice(0, 200);
      try {
        await this.queue.complete(jobId, this.workerId, false, safeErr);
      } catch {
        /* fail-soft: se persistência falhar, health/metrics ainda registram */
      }
      this.health.markEnd(safeErr);
      this.heartbeat.tick();
      const processingMs = RuntimeClock.now() - started;
      this.metrics.record({
        outcome: "failure",
        processingMs,
        queueLatencyMs: 0,
        executionLatencyMs: 0,
      });
      return {
        workerId: this.workerId,
        jobId,
        found: true,
        ok: false,
        reason: safeErr,
        report: null,
        processingMs,
        learning: null,
      };
    }

    const outcome = report.result.outcome === "success" ? "success"
      : report.result.outcome === "failure" ? "failure"
      : report.result.outcome === "timeout" ? "timeout"
      : report.result.outcome === "cancelled" ? "cancelled"
      : report.result.outcome === "blocked" ? "blocked"
      : "stub";

    // Sucesso operacional exige outcome=success e stub=false.
    const persistSuccess =
      outcome === "success" && report.result.stub !== true;
    try {
      const errCode = persistSuccess
        ? null
        : (report.result.error ?? outcome).slice(0, 200);
      await this.queue.complete(jobId, this.workerId, persistSuccess, errCode);
    } catch {
      /* fail-soft */
    }

    this.health.markEnd(report.result.error);
    this.heartbeat.tick();
    const processingMs = RuntimeClock.now() - started;
    const queueLatencyMs = Math.max(
      0,
      started - new Date(job.scheduledAt).getTime(),
    );
    this.metrics.record({
      outcome,
      processingMs,
      queueLatencyMs,
      executionLatencyMs: report.totalDurationMs,
    });

    // Registra a última execução real (allowlist-gated no engine).
    this.engine.recordLastRealExecution({
      agentId: report.agentId,
      executionId: report.executionId,
      jobId: report.jobId,
      tenantId: report.tenantId,
      workerId: this.workerId,
      outcome: report.result.outcome,
      reason: report.reason,
      startedAt: report.result.startedAt,
      finishedAt: report.result.finishedAt,
      durationMs: report.result.durationMs,
      error: report.result.error,
    });

    // Learning Loop APÓS conclusão persistida com sucesso.
    let learning: LearningCycleReport | null = null;
    if (this.learningLoop && persistSuccess) {
      try {
        learning = await this.learningLoop.onExecutionCompleted(report.result);
      } catch {
        learning = null;
      }
    }

    return {
      workerId: this.workerId,
      jobId,
      found: true,
      ok: report.ok && persistSuccess,
      reason: report.reason,
      report,
      processingMs,
      learning,
    };
  }

  snapshot(): {
    workerId: string;
    startedAt: string;
    health: WorkerHealthSnapshot;
    metrics: WorkerMetricsSnapshot;
    heartbeat: WorkerHeartbeatTick | null;
  } {
    return {
      workerId: this.workerId,
      startedAt: this.startedAtIso,
      health: this.health.snapshot(),
      metrics: this.metrics.snapshot(),
      heartbeat: this.heartbeat.lastTick(),
    };
  }
}
