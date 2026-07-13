// ============================================================================
// RuntimeExecutionEngine — Motor único de execução do Runtime.
// Etapa 4: NÃO executa agentes. execute() roda o pipeline até o STUB.
// Toda execução futura passará OBRIGATORIAMENTE por este motor.
// ============================================================================

import type { AgentAdapterRegistry } from "./AgentAdapterRegistry.server";
import type { AgentDispatcher } from "./AgentDispatcher.server";
import type { AgentRegistry } from "./AgentRegistry.server";
import { createExecutionContext, type ExecutionRuntimeRefs } from "./ExecutionContext.server";
import { ExecutionHealth } from "./ExecutionHealth.server";
import { ExecutionLocks } from "./ExecutionLocks.server";
import { ExecutionMetrics } from "./ExecutionMetrics.server";
import { ExecutionPipeline, type PipelineRunReport } from "./ExecutionPipeline.server";
import type { RuntimeHeartbeat } from "./RuntimeHeartbeat.server";
import type { RuntimeScheduler } from "./RuntimeScheduler.server";
import type { RuntimeJobRecord } from "./RuntimeTypes";

/** Etapa 6: apenas `system-health` pode executar REAL. */
export const REAL_EXECUTION_ALLOWLIST: ReadonlySet<string> = new Set(["system-health"]);

export interface ExecutionEngineDeps {
  registry: AgentRegistry;
  dispatcher: AgentDispatcher;
  scheduler: RuntimeScheduler;
  heartbeat: RuntimeHeartbeat;
  adapters?: AgentAdapterRegistry | null;
}

export interface LastRealExecution {
  agentId: string;
  executionId: string;
  jobId: string;
  tenantId: string;
  workerId: string | null;
  outcome: string;
  reason: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number;
  error: string | null;
}

export class RuntimeExecutionEngine {
  readonly locks = new ExecutionLocks();
  readonly metrics = new ExecutionMetrics();
  readonly health: ExecutionHealth;
  readonly pipeline: ExecutionPipeline;
  readonly allowlist: ReadonlySet<string> = REAL_EXECUTION_ALLOWLIST;

  private deps: ExecutionEngineDeps;
  private lastRealExecutionByAgent = new Map<string, LastRealExecution>();

  constructor(deps: ExecutionEngineDeps) {
    this.deps = deps;
    this.pipeline = new ExecutionPipeline({
      registry: deps.registry,
      locks: this.locks,
      adapters: deps.adapters ?? null,
      realExecutionAllowlist: this.allowlist,
    });
    this.health = new ExecutionHealth(this.locks, this.metrics);
  }

  /** Chamado pelo Worker após executar. Registra a última execução real. */
  recordLastRealExecution(entry: LastRealExecution): void {
    if (!this.allowlist.has(entry.agentId)) return;
    this.lastRealExecutionByAgent.set(entry.agentId, entry);
  }

  lastRealExecution(agentId: string): LastRealExecution | null {
    return this.lastRealExecutionByAgent.get(agentId) ?? null;
  }

  lastRealExecutions(): LastRealExecution[] {
    return Array.from(this.lastRealExecutionByAgent.values());
  }

  /** Reconecta dependências (usado quando o Runtime é rebindado a um writer). */
  rebind(deps: Partial<ExecutionEngineDeps>): void {
    this.deps = { ...this.deps, ...deps };
  }

  private runtimeRefs(): ExecutionRuntimeRefs {
    return {
      registry: this.deps.registry,
      dispatcher: this.deps.dispatcher,
      scheduler: this.deps.scheduler,
      heartbeat: this.deps.heartbeat,
    };
  }

  /**
   * Executa um job pelo pipeline. Etapa 4: apenas STUB.
   * Nunca chama agente real. Sempre retorna PipelineRunReport.
   */
  async execute(job: RuntimeJobRecord): Promise<PipelineRunReport> {
    const ctx = createExecutionContext({ job, runtime: this.runtimeRefs() });
    this.health.markStart();
    try {
      const report = await this.pipeline.run(ctx);
      this.metrics.record({
        result: report.result,
        queueWaitMs: Math.max(
          0,
          new Date(ctx.createdAtMs).getTime() - new Date(job.scheduledAt).getTime(),
        ),
      });
      this.health.markEnd(report.result);
      return report;
    } catch (e) {
      const err = e instanceof Error ? e.message : "engine_error";
      const fallback: PipelineRunReport = {
        executionId: ctx.executionId,
        agentId: ctx.agentId,
        tenantId: ctx.tenantId,
        jobId: job.id,
        ok: false,
        reason: err,
        stages: [],
        result: {
          executionId: ctx.executionId,
          jobId: job.id,
          agentId: ctx.agentId,
          tenantId: ctx.tenantId,
          outcome: "failure",
          reason: err,
          attempt: ctx.attempt,
          startedAt: ctx.createdAtIso,
          finishedAt: new Date().toISOString(),
          durationMs: 0,
          stub: false,
          error: err,
        },
        totalDurationMs: 0,
      };
      this.metrics.record({ result: fallback.result });
      this.health.markEnd(fallback.result);
      return fallback;
    }
  }

  snapshot() {
    return {
      state: this.health.snapshot().state,
      pipeline: this.pipeline.snapshot(),
      locks: this.locks.snapshot(),
      health: this.health.snapshot(),
      metrics: {
        aggregate: this.metrics.aggregate(),
        perAgent: this.metrics.snapshot(),
      },
      allowlist: Array.from(this.allowlist),
      lastRealExecutions: this.lastRealExecutions(),
    };
  }
}
