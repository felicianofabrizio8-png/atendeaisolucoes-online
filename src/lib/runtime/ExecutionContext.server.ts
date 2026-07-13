// ============================================================================
// ExecutionContext — Contexto imutável de uma execução do Runtime.
// NÃO carrega payload operacional. Somente coordenadas.
// ============================================================================

import type { AgentDispatcher } from "./AgentDispatcher.server";
import type { AgentRegistry } from "./AgentRegistry.server";
import type { RuntimeHeartbeat } from "./RuntimeHeartbeat.server";
import type { RuntimeScheduler } from "./RuntimeScheduler.server";
import { RuntimeClock } from "./RuntimeClock.server";
import type { SharedIntelligenceContext } from "./context/SharedIntelligenceContext.server";
import type { RuntimeJobPriority, RuntimeJobRecord } from "./RuntimeTypes";

export interface ExecutionRuntimeRefs {
  registry: AgentRegistry;
  dispatcher: AgentDispatcher;
  scheduler: RuntimeScheduler;
  heartbeat: RuntimeHeartbeat;
  context?: SharedIntelligenceContext | null;
}

export interface ExecutionContext {
  executionId: string;
  correlationId: string | null;
  tenantId: string;
  agentId: string;
  job: RuntimeJobRecord;
  attempt: number;
  priority: RuntimeJobPriority;
  createdAtIso: string;
  createdAtMs: number;
  runtime: ExecutionRuntimeRefs;
  clock: typeof RuntimeClock;
}

function randomId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `exec_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function createExecutionContext(input: {
  job: RuntimeJobRecord;
  runtime: ExecutionRuntimeRefs;
}): ExecutionContext {
  const nowMs = RuntimeClock.now();
  return {
    executionId: randomId(),
    correlationId: input.job.correlationId,
    tenantId: input.job.tenantId,
    agentId: input.job.agentId,
    job: input.job,
    attempt: input.job.attempt,
    priority: input.job.priority,
    createdAtIso: new Date(nowMs).toISOString(),
    createdAtMs: nowMs,
    runtime: input.runtime,
    clock: RuntimeClock,
  };
}
