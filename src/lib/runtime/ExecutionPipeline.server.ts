// ============================================================================
// ExecutionPipeline — Pipeline determinístico do Execution Engine.
// Etapas: validate → prepare → resolveDependencies → acquireLock → ready →
//         execute(STUB) → releaseLock → finish
// Nenhum agente é chamado. `execute` sempre retorna stubResult.
// ============================================================================

import type { AgentRegistry } from "./AgentRegistry.server";
import { RuntimeClock } from "./RuntimeClock.server";
import type { ExecutionContext } from "./ExecutionContext.server";
import type { ExecutionLocks, LockHandle } from "./ExecutionLocks.server";
import { stubResult, type ExecutionResult } from "./ExecutionResult.server";

export type PipelineStage =
  | "validate"
  | "prepare"
  | "resolve_dependencies"
  | "acquire_lock"
  | "ready"
  | "execute"
  | "release_lock"
  | "finish";

export interface PipelineStageReport {
  stage: PipelineStage;
  ok: boolean;
  reason: string;
  durationMs: number;
}

export interface PipelineRunReport {
  executionId: string;
  agentId: string;
  tenantId: string;
  jobId: string;
  ok: boolean;
  reason: string;
  stages: PipelineStageReport[];
  result: ExecutionResult;
  totalDurationMs: number;
}

interface PipelineDeps {
  registry: AgentRegistry;
  locks: ExecutionLocks;
}

export class ExecutionPipeline {
  private lastReport: PipelineRunReport | null = null;
  private totalRuns = 0;
  private stageCounters: Record<PipelineStage, number> = {
    validate: 0,
    prepare: 0,
    resolve_dependencies: 0,
    acquire_lock: 0,
    ready: 0,
    execute: 0,
    release_lock: 0,
    finish: 0,
  };

  constructor(private readonly deps: PipelineDeps) {}

  /** Executa o pipeline até o STUB. Não chama nenhum agente. */
  async run(ctx: ExecutionContext): Promise<PipelineRunReport> {
    const stages: PipelineStageReport[] = [];
    const startedMs = RuntimeClock.now();
    let lock: LockHandle | null = null;
    let ok = true;
    let reason = "pipeline_stub_complete";

    const runStage = async (
      stage: PipelineStage,
      fn: () => Promise<{ ok: boolean; reason: string }>,
    ): Promise<PipelineStageReport> => {
      const s = RuntimeClock.now();
      let result: { ok: boolean; reason: string };
      try {
        result = await fn();
      } catch (e) {
        result = { ok: false, reason: e instanceof Error ? e.message : "stage_error" };
      }
      const report: PipelineStageReport = {
        stage,
        ok: result.ok,
        reason: result.reason,
        durationMs: RuntimeClock.now() - s,
      };
      stages.push(report);
      this.stageCounters[stage] += 1;
      return report;
    };

    // validate
    const v = await runStage("validate", async () => {
      if (!ctx.tenantId) return { ok: false, reason: "missing_tenant" };
      if (!ctx.agentId) return { ok: false, reason: "missing_agent" };
      if (!this.deps.registry.get(ctx.agentId)) return { ok: false, reason: "agent_unknown" };
      return { ok: true, reason: "valid" };
    });
    if (!v.ok) {
      ok = false;
      reason = v.reason;
    }

    // prepare
    if (ok) {
      const p = await runStage("prepare", async () => ({ ok: true, reason: "prepared" }));
      if (!p.ok) {
        ok = false;
        reason = p.reason;
      }
    }

    // resolve dependencies (structural only — nenhuma execução)
    if (ok) {
      const r = await runStage("resolve_dependencies", async () => {
        const agent = this.deps.registry.get(ctx.agentId)!;
        for (const dep of agent.descriptor.dependencies) {
          if (!this.deps.registry.get(dep)) {
            return { ok: false, reason: `missing_dependency:${dep}` };
          }
        }
        return { ok: true, reason: "resolved" };
      });
      if (!r.ok) {
        ok = false;
        reason = r.reason;
      }
    }

    // acquire lock
    if (ok) {
      const a = await runStage("acquire_lock", async () => {
        const bucket = Math.floor(RuntimeClock.now() / 60_000);
        const key = `lock:${ctx.tenantId}:${ctx.agentId}:${bucket}`;
        const agent = this.deps.registry.get(ctx.agentId)!;
        const acq = this.deps.locks.acquire(key, agent.descriptor.timeoutPolicy.hardTimeoutMs);
        if (!acq.acquired) return { ok: false, reason: acq.reason };
        lock = acq.handle;
        return { ok: true, reason: "locked" };
      });
      if (!a.ok) {
        ok = false;
        reason = a.reason;
      }
    }

    // ready
    if (ok) {
      await runStage("ready", async () => ({ ok: true, reason: "ready" }));
    }

    // execute — STUB nesta etapa
    let result: ExecutionResult;
    if (ok) {
      await runStage("execute", async () => ({ ok: true, reason: "execution_stub" }));
      result = stubResult({
        executionId: ctx.executionId,
        jobId: ctx.job.id,
        agentId: ctx.agentId,
        tenantId: ctx.tenantId,
        attempt: ctx.attempt,
        reason: "execution_stub",
      });
    } else {
      result = {
        ...stubResult({
          executionId: ctx.executionId,
          jobId: ctx.job.id,
          agentId: ctx.agentId,
          tenantId: ctx.tenantId,
          attempt: ctx.attempt,
          reason,
        }),
        outcome: "blocked",
      };
    }

    // release lock
    if (lock) {
      await runStage("release_lock", async () => {
        lock!.release();
        return { ok: true, reason: "released" };
      });
    }

    // finish
    const totalDurationMs = RuntimeClock.now() - startedMs;
    result.durationMs = totalDurationMs;
    result.startedAt = new Date(startedMs).toISOString();
    result.finishedAt = RuntimeClock.nowIso();
    await runStage("finish", async () => ({ ok, reason }));

    const report: PipelineRunReport = {
      executionId: ctx.executionId,
      agentId: ctx.agentId,
      tenantId: ctx.tenantId,
      jobId: ctx.job.id,
      ok,
      reason,
      stages,
      result,
      totalDurationMs,
    };
    this.lastReport = report;
    this.totalRuns += 1;
    return report;
  }

  snapshot() {
    return {
      totalRuns: this.totalRuns,
      stageCounters: { ...this.stageCounters },
      lastReport: this.lastReport
        ? {
            executionId: this.lastReport.executionId,
            agentId: this.lastReport.agentId,
            tenantId: this.lastReport.tenantId,
            jobId: this.lastReport.jobId,
            ok: this.lastReport.ok,
            reason: this.lastReport.reason,
            totalDurationMs: this.lastReport.totalDurationMs,
            stages: this.lastReport.stages,
          }
        : null,
    };
  }
}
