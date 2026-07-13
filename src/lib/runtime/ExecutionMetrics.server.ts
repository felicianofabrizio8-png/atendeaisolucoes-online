// ============================================================================
// ExecutionMetrics — Acumuladores in-memory de métricas de execução.
// Etapa 4: estrutura apenas. Nenhum agente executa.
// ============================================================================

import { RuntimeClock } from "./RuntimeClock.server";
import type { ExecutionOutcome, ExecutionResult } from "./ExecutionResult.server";

export interface AgentMetricSnapshot {
  agentId: string;
  totalExecutions: number;
  success: number;
  failure: number;
  timeout: number;
  cancelled: number;
  blocked: number;
  stub: number;
  retry: number;
  totalDurationMs: number;
  avgDurationMs: number;
  totalQueueWaitMs: number;
  totalLockWaitMs: number;
  totalTokens: number;
  totalCostCents: number;
  lastOutcome: ExecutionOutcome | null;
  lastAt: string | null;
}

interface Bucket {
  agentId: string;
  totalExecutions: number;
  success: number;
  failure: number;
  timeout: number;
  cancelled: number;
  blocked: number;
  stub: number;
  retry: number;
  totalDurationMs: number;
  totalQueueWaitMs: number;
  totalLockWaitMs: number;
  totalTokens: number;
  totalCostCents: number;
  lastOutcome: ExecutionOutcome | null;
  lastAtMs: number | null;
}

function empty(agentId: string): Bucket {
  return {
    agentId,
    totalExecutions: 0,
    success: 0,
    failure: 0,
    timeout: 0,
    cancelled: 0,
    blocked: 0,
    stub: 0,
    retry: 0,
    totalDurationMs: 0,
    totalQueueWaitMs: 0,
    totalLockWaitMs: 0,
    totalTokens: 0,
    totalCostCents: 0,
    lastOutcome: null,
    lastAtMs: null,
  };
}

export interface RecordMetricInput {
  result: ExecutionResult;
  queueWaitMs?: number;
  lockWaitMs?: number;
  tokens?: number;
  costCents?: number;
}

export class ExecutionMetrics {
  private readonly buckets = new Map<string, Bucket>();

  record(input: RecordMetricInput): void {
    const { result } = input;
    const b = this.buckets.get(result.agentId) ?? empty(result.agentId);
    b.totalExecutions += 1;
    b.totalDurationMs += Math.max(0, result.durationMs);
    b.totalQueueWaitMs += Math.max(0, input.queueWaitMs ?? 0);
    b.totalLockWaitMs += Math.max(0, input.lockWaitMs ?? 0);
    b.totalTokens += Math.max(0, input.tokens ?? 0);
    b.totalCostCents += Math.max(0, input.costCents ?? 0);
    b.lastOutcome = result.outcome;
    b.lastAtMs = RuntimeClock.now();
    if (result.attempt > 1) b.retry += 1;
    switch (result.outcome) {
      case "success":
        b.success += 1;
        break;
      case "failure":
        b.failure += 1;
        break;
      case "timeout":
        b.timeout += 1;
        break;
      case "cancelled":
        b.cancelled += 1;
        break;
      case "blocked":
        b.blocked += 1;
        break;
      case "stub":
        b.stub += 1;
        break;
    }
    this.buckets.set(result.agentId, b);
  }

  snapshotForAgent(agentId: string): AgentMetricSnapshot {
    const b = this.buckets.get(agentId) ?? empty(agentId);
    return this.toSnapshot(b);
  }

  snapshot(): AgentMetricSnapshot[] {
    return Array.from(this.buckets.values()).map((b) => this.toSnapshot(b));
  }

  aggregate() {
    let totalExecutions = 0;
    let success = 0;
    let failure = 0;
    let timeout = 0;
    let stub = 0;
    let totalDurationMs = 0;
    let totalTokens = 0;
    let totalCostCents = 0;
    for (const b of this.buckets.values()) {
      totalExecutions += b.totalExecutions;
      success += b.success;
      failure += b.failure;
      timeout += b.timeout;
      stub += b.stub;
      totalDurationMs += b.totalDurationMs;
      totalTokens += b.totalTokens;
      totalCostCents += b.totalCostCents;
    }
    return {
      totalExecutions,
      success,
      failure,
      timeout,
      stub,
      totalDurationMs,
      avgDurationMs: totalExecutions > 0 ? Math.round(totalDurationMs / totalExecutions) : 0,
      totalTokens,
      totalCostCents,
    };
  }

  private toSnapshot(b: Bucket): AgentMetricSnapshot {
    return {
      agentId: b.agentId,
      totalExecutions: b.totalExecutions,
      success: b.success,
      failure: b.failure,
      timeout: b.timeout,
      cancelled: b.cancelled,
      blocked: b.blocked,
      stub: b.stub,
      retry: b.retry,
      totalDurationMs: b.totalDurationMs,
      avgDurationMs: b.totalExecutions > 0 ? Math.round(b.totalDurationMs / b.totalExecutions) : 0,
      totalQueueWaitMs: b.totalQueueWaitMs,
      totalLockWaitMs: b.totalLockWaitMs,
      totalTokens: b.totalTokens,
      totalCostCents: b.totalCostCents,
      lastOutcome: b.lastOutcome,
      lastAt: b.lastAtMs ? new Date(b.lastAtMs).toISOString() : null,
    };
  }
}
