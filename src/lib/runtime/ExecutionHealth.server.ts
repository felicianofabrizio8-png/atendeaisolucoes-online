// ============================================================================
// ExecutionHealth — Estado agregado do Execution Engine.
// Sem monitoramento ativo. Snapshot sob demanda.
// ============================================================================

import { RuntimeClock } from "./RuntimeClock.server";
import type { ExecutionLocks } from "./ExecutionLocks.server";
import type { ExecutionMetrics } from "./ExecutionMetrics.server";
import type { ExecutionResult } from "./ExecutionResult.server";

export type ExecutionEngineState = "idle" | "running" | "blocked" | "degraded";

export interface ExecutionHealthSnapshot {
  ts: string;
  state: ExecutionEngineState;
  running: number;
  totalCompleted: number;
  totalFailed: number;
  totalTimeout: number;
  totalStub: number;
  lastExecutionAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  activeLocks: number;
}

export class ExecutionHealth {
  private running = 0;
  private lastExecutionAtMs: number | null = null;
  private lastSuccessAtMs: number | null = null;
  private lastFailureAtMs: number | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly locks: ExecutionLocks,
    private readonly metrics: ExecutionMetrics,
  ) {}

  markStart(): void {
    this.running += 1;
  }

  markEnd(result: ExecutionResult): void {
    this.running = Math.max(0, this.running - 1);
    const ts = RuntimeClock.now();
    this.lastExecutionAtMs = ts;
    if (result.outcome === "success") {
      this.lastSuccessAtMs = ts;
      this.lastError = null;
    } else if (result.outcome === "failure" || result.outcome === "timeout") {
      this.lastFailureAtMs = ts;
      this.lastError = result.error ?? result.reason;
    }
  }

  snapshot(): ExecutionHealthSnapshot {
    const agg = this.metrics.aggregate();
    const activeLocks = this.locks.snapshot().active;
    const state: ExecutionEngineState =
      this.running > 0 ? "running" : activeLocks > 0 ? "blocked" : "idle";
    return {
      ts: RuntimeClock.nowIso(),
      state,
      running: this.running,
      totalCompleted: agg.success,
      totalFailed: agg.failure,
      totalTimeout: agg.timeout,
      totalStub: agg.stub,
      lastExecutionAt: this.lastExecutionAtMs ? new Date(this.lastExecutionAtMs).toISOString() : null,
      lastSuccessAt: this.lastSuccessAtMs ? new Date(this.lastSuccessAtMs).toISOString() : null,
      lastFailureAt: this.lastFailureAtMs ? new Date(this.lastFailureAtMs).toISOString() : null,
      lastError: this.lastError,
      activeLocks,
    };
  }
}
