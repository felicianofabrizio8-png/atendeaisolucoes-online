// ============================================================================
// AgentAdapter — Interface única entre Execution Engine e Agentes.
// Etapa 5: execute() é STUB. Nenhum agente é chamado.
// ============================================================================

import type { ExecutionContext } from "./ExecutionContext.server";
import { stubResult, type ExecutionResult } from "./ExecutionResult.server";

export type AdapterHealthLevel = "healthy" | "degraded" | "unknown" | "down";

export interface AdapterHealthSnapshot {
  level: AdapterHealthLevel;
  lastCheckAt: string | null;
  lastError: string | null;
}

export interface AgentAdapter {
  readonly agentId: string;
  readonly version: string;
  readonly supportedJobs: string[];
  validate(ctx: ExecutionContext): Promise<{ ok: boolean; reason: string }>;
  prepare(ctx: ExecutionContext): Promise<{ ok: boolean; reason: string }>;
  execute(ctx: ExecutionContext): Promise<ExecutionResult>;
  cleanup(ctx: ExecutionContext): Promise<void>;
  health(): AdapterHealthSnapshot;
}

/**
 * Adapter genérico STUB. Todos os agentes existentes ganham um destes
 * automaticamente. Não altera nenhum comportamento operacional.
 */
export class StubAgentAdapter implements AgentAdapter {
  private lastError: string | null = null;
  private lastCheckAt: string | null = null;

  constructor(
    readonly agentId: string,
    readonly version: string = "stub-1.0.0",
    readonly supportedJobs: string[] = [],
  ) {}

  async validate(ctx: ExecutionContext): Promise<{ ok: boolean; reason: string }> {
    if (!ctx.tenantId) return { ok: false, reason: "missing_tenant" };
    if (ctx.agentId !== this.agentId) return { ok: false, reason: "agent_mismatch" };
    return { ok: true, reason: "valid" };
  }

  async prepare(_ctx: ExecutionContext): Promise<{ ok: boolean; reason: string }> {
    return { ok: true, reason: "prepared" };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    return stubResult({
      executionId: ctx.executionId,
      jobId: ctx.job.id,
      agentId: ctx.agentId,
      tenantId: ctx.tenantId,
      attempt: ctx.attempt,
      reason: "adapter_stub",
    });
  }

  async cleanup(_ctx: ExecutionContext): Promise<void> {
    /* no-op */
  }

  health(): AdapterHealthSnapshot {
    return { level: "unknown", lastCheckAt: this.lastCheckAt, lastError: this.lastError };
  }
}
