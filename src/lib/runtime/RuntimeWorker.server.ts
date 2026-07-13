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
      };
    }

    this.health.markStart(jobId);
    let report: PipelineRunReport;
    let err: string | null = null;
    try {
      report = await this.engine.execute(job);
    } catch (e) {
      err = e instanceof Error ? e.message : "worker_error";
      this.health.markEnd(err);
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
        reason: err,
        report: null,
        processingMs,
      };
    }

    this.health.markEnd(report.result.error);
    this.heartbeat.tick();
    const processingMs = RuntimeClock.now() - started;
    const queueLatencyMs = Math.max(
      0,
      started - new Date(job.scheduledAt).getTime(),
    );
    this.metrics.record({
      outcome: report.result.outcome as WorkerProcessResult extends never ? never : "success" | "failure" | "stub" | "timeout" | "cancelled" | "blocked",
      processingMs,
      queueLatencyMs,
      executionLatencyMs: report.totalDurationMs,
    });
    return {
      workerId: this.workerId,
      jobId,
      found: true,
      ok: report.ok,
      reason: report.reason,
      report,
      processingMs,
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
