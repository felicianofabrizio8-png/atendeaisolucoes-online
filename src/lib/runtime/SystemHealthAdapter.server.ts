// ============================================================================
// SystemHealthAdapter — Primeiro adapter real do Runtime (Etapa 6).
// Executa uma probe interna de saúde do próprio Runtime — SEM tocar em
// tabelas, agentes operacionais ou APIs externas. Zero side-effect.
// Substitui apenas o StubAdapter de `system-health`. Todos os demais
// agentes continuam com StubAgentAdapter.
// ============================================================================

import type { AdapterHealthSnapshot, AgentAdapter } from "./AgentAdapter.server";
import type { ExecutionContext } from "./ExecutionContext.server";
import type { ExecutionResult } from "./ExecutionResult.server";
import { RuntimeClock } from "./RuntimeClock.server";

export interface SystemHealthProbe {
  runtimeUptimeMs: number;
  registeredAgents: number;
  healthyAgents: number;
  adapters: number;
  heartbeatAgeMs: number | null;
  schedulerAgendas: number;
  queueBound: boolean;
  checkedAt: string;
}

export class SystemHealthAdapter implements AgentAdapter {
  readonly agentId = "system-health";
  readonly version = "real-1.0.0";
  readonly supportedJobs = ["runtime:system-health"];

  private lastCheckAtMs: number | null = null;
  private lastError: string | null = null;
  private lastProbe: SystemHealthProbe | null = null;
  private consecutiveFailures = 0;

  async validate(ctx: ExecutionContext): Promise<{ ok: boolean; reason: string }> {
    if (!ctx.tenantId) return { ok: false, reason: "missing_tenant" };
    if (ctx.agentId !== this.agentId) return { ok: false, reason: "agent_mismatch" };
    if (!ctx.runtime?.registry) return { ok: false, reason: "runtime_refs_missing" };
    return { ok: true, reason: "valid" };
  }

  async prepare(_ctx: ExecutionContext): Promise<{ ok: boolean; reason: string }> {
    return { ok: true, reason: "prepared" };
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const startedMs = RuntimeClock.now();
    const startedIso = new Date(startedMs).toISOString();
    try {
      const registry = ctx.runtime.registry;
      const heartbeat = ctx.runtime.heartbeat;
      const scheduler = ctx.runtime.scheduler;

      const lastTick = heartbeat?.last?.() ?? null;
      const heartbeatAgeMs = lastTick?.at
        ? Math.max(0, RuntimeClock.now() - new Date(lastTick.at).getTime())
        : null;

      const schedulerSnap = scheduler?.snapshot?.() as
        | { agendas?: unknown[] }
        | undefined;
      const schedulerAgendas = Array.isArray(schedulerSnap?.agendas)
        ? schedulerSnap!.agendas!.length
        : 0;

      const probe: SystemHealthProbe = {
        runtimeUptimeMs: heartbeat?.last?.()
          ? Math.max(0, RuntimeClock.now() - new Date(heartbeat.last()!.at).getTime())
          : 0,
        registeredAgents: registry.size(),
        healthyAgents: registry.healthyCount(),
        adapters: 0, // preenchido pelo Runtime via getLastProbe se necessário
        heartbeatAgeMs,
        schedulerAgendas,
        queueBound: Boolean(
          (ctx.runtime.dispatcher as unknown as { queue?: unknown } | null)?.queue,
        ),
        checkedAt: RuntimeClock.nowIso(),
      };

      this.lastCheckAtMs = RuntimeClock.now();
      this.lastError = null;
      this.lastProbe = probe;
      this.consecutiveFailures = 0;

      const finishedMs = RuntimeClock.now();
      return {
        executionId: ctx.executionId,
        jobId: ctx.job.id,
        agentId: ctx.agentId,
        tenantId: ctx.tenantId,
        outcome: "success",
        reason: "system_health_probe_ok",
        attempt: ctx.attempt,
        startedAt: startedIso,
        finishedAt: new Date(finishedMs).toISOString(),
        durationMs: finishedMs - startedMs,
        stub: false,
        error: null,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "system_health_error";
      this.lastCheckAtMs = RuntimeClock.now();
      this.lastError = msg;
      this.consecutiveFailures += 1;
      const finishedMs = RuntimeClock.now();
      return {
        executionId: ctx.executionId,
        jobId: ctx.job.id,
        agentId: ctx.agentId,
        tenantId: ctx.tenantId,
        outcome: "failure",
        reason: msg,
        attempt: ctx.attempt,
        startedAt: startedIso,
        finishedAt: new Date(finishedMs).toISOString(),
        durationMs: finishedMs - startedMs,
        stub: false,
        error: msg,
      };
    }
  }

  async cleanup(_ctx: ExecutionContext): Promise<void> {
    /* no-op: adapter é stateless */
  }

  health(): AdapterHealthSnapshot {
    let level: AdapterHealthSnapshot["level"] = "unknown";
    if (this.lastCheckAtMs !== null) {
      if (this.consecutiveFailures === 0) level = "healthy";
      else if (this.consecutiveFailures < 3) level = "degraded";
      else level = "down";
    }
    return {
      level,
      lastCheckAt: this.lastCheckAtMs ? new Date(this.lastCheckAtMs).toISOString() : null,
      lastError: this.lastError,
    };
  }

  lastProbeSnapshot(): SystemHealthProbe | null {
    return this.lastProbe;
  }
}
