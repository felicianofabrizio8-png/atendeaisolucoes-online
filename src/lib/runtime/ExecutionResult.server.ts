// ============================================================================
// ExecutionResult — Contratos de resultado do Execution Engine.
// Esta etapa: stub. Nenhum agente é executado.
// ============================================================================

export type ExecutionOutcome =
  | "success"
  | "failure"
  | "timeout"
  | "cancelled"
  | "blocked"
  | "stub";

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
