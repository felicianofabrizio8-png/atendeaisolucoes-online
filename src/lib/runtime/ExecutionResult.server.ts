// ============================================================================
// ExecutionResult — Contratos de resultado do Execution Engine.
// Etapa 11: bloco knowledgeBus expandido para telemetria producer/consumer.
// ============================================================================

export type ExecutionOutcome =
  | "success"
  | "failure"
  | "timeout"
  | "cancelled"
  | "blocked"
  | "stub";

export interface ExecutionResultKnowledgeBus {
  // Backward-compat (Etapa 10, primeiro consumer)
  knowledgeBusHit: boolean;
  knowledgeBusFallback: boolean;
  knowledgeTopic: string | null;
  knowledgeEnvelopeVersion: number | null;
  knowledgeEnvelopeAge: number | null;
  // Etapa 11: telemetria agregada
  reads?: number;
  hits?: number;
  misses?: number;
  partialHits?: number;
  fallbacks?: number;
  topicsUsed?: string[];
  envelopeVersions?: Record<string, number>;
  maxEnvelopeAgeSeconds?: number | null;
  publishedTopics?: string[];
  publishErrors?: number;
}

export interface ExecutionResult {
  executionId: string;
  jobId: string;
  agentId: string;
  tenantId: string;
  outcome: ExecutionOutcome;
  reason: string;
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number;
  stub: boolean;
  error: string | null;
  knowledgeBus?: ExecutionResultKnowledgeBus;
}

export function stubResult(input: {
  executionId: string;
  jobId: string;
  agentId: string;
  tenantId: string;
  attempt: number;
  reason?: string;
}): ExecutionResult {
  return {
    executionId: input.executionId,
    jobId: input.jobId,
    agentId: input.agentId,
    tenantId: input.tenantId,
    outcome: "stub",
    reason: input.reason ?? "execution_stub",
    attempt: input.attempt,
    startedAt: null,
    finishedAt: null,
    durationMs: 0,
    stub: true,
    error: null,
  };
}
