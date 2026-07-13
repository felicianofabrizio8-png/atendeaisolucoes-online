// ============================================================================
// WorkerMetrics — Acumuladores in-memory de métricas do Worker.
// Sem persistência. Sem exportação.
// ============================================================================

import { RuntimeClock } from "./RuntimeClock.server";

export interface WorkerMetricsSnapshot {
  totalProcessed: number;
  success: number;
  failure: number;
  retry: number;
  stub: number;
  totalProcessingMs: number;
  avgProcessingMs: number;
  totalQueueLatencyMs: number;
  avgQueueLatencyMs: number;
  totalExecutionLatencyMs: number;
  avgExecutionLatencyMs: number;
  lastProcessedAt: string | null;
}

export interface RecordWorkerMetricInput {
  outcome: "success" | "failure" | "stub" | "retry" | "timeout" | "cancelled" | "blocked";
  processingMs: number;
  queueLatencyMs: number;
  executionLatencyMs: number;
}

export class WorkerMetrics {
  private totalProcessed = 0;
  private success = 0;
  private failure = 0;
  private retry = 0;
  private stub = 0;
  private totalProcessingMs = 0;
  private totalQueueLatencyMs = 0;
  private totalExecutionLatencyMs = 0;
  private lastProcessedAtMs: number | null = null;

  record(input: RecordWorkerMetricInput): void {
    this.totalProcessed += 1;
    this.totalProcessingMs += Math.max(0, input.processingMs);
    this.totalQueueLatencyMs += Math.max(0, input.queueLatencyMs);
    this.totalExecutionLatencyMs += Math.max(0, input.executionLatencyMs);
    this.lastProcessedAtMs = RuntimeClock.now();
    switch (input.outcome) {
      case "success":
        this.success += 1;
        break;
      case "failure":
      case "timeout":
        this.failure += 1;
        break;
      case "retry":
        this.retry += 1;
        break;
      case "stub":
        this.stub += 1;
        break;
    }
  }

  snapshot(): WorkerMetricsSnapshot {
    const n = this.totalProcessed;
    return {
      totalProcessed: n,
      success: this.success,
      failure: this.failure,
      retry: this.retry,
      stub: this.stub,
      totalProcessingMs: this.totalProcessingMs,
      avgProcessingMs: n > 0 ? Math.round(this.totalProcessingMs / n) : 0,
      totalQueueLatencyMs: this.totalQueueLatencyMs,
      avgQueueLatencyMs: n > 0 ? Math.round(this.totalQueueLatencyMs / n) : 0,
      totalExecutionLatencyMs: this.totalExecutionLatencyMs,
      avgExecutionLatencyMs: n > 0 ? Math.round(this.totalExecutionLatencyMs / n) : 0,
      lastProcessedAt: this.lastProcessedAtMs ? new Date(this.lastProcessedAtMs).toISOString() : null,
    };
  }
}
