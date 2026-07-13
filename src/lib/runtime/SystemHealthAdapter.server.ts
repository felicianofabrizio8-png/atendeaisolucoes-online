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

export interface SystemHealthPublisherStats {
  connected: boolean;
  publishCount: number;
  publishErrors: number;
  lastPublishedAtMs: number | null;
  lastError: string | null;
  lastEnvelopeId: string | null;
  lastExpiresAt: string | null;
  lastTenantId: string | null;
}

const SYSTEM_HEALTH_TTL_MS = 5 * 60 * 1000;

function stableHash(input: unknown): string {
  const str = typeof input === "string" ? input : JSON.stringify(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function healthLevelFrom(probe: SystemHealthProbe): "healthy" | "degraded" | "down" {
  if (probe.registeredAgents === 0) return "down";
  if (probe.healthyAgents < probe.registeredAgents) return "degraded";
  if (probe.heartbeatAgeMs !== null && probe.heartbeatAgeMs > 60_000) return "degraded";
  return "healthy";
}

export class SystemHealthAdapter implements AgentAdapter {
  readonly agentId = "system-health";
  readonly version = "real-1.1.0";
  readonly supportedJobs = ["runtime:system-health"];

  private lastCheckAtMs: number | null = null;
  private lastError: string | null = null;
  private lastProbe: SystemHealthProbe | null = null;
  private consecutiveFailures = 0;

  private publisherStats: SystemHealthPublisherStats = {
    connected: false,
    publishCount: 0,
    publishErrors: 0,
    lastPublishedAtMs: null,
    lastError: null,
    lastEnvelopeId: null,
    lastExpiresAt: null,
    lastTenantId: null,
  };

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
      const lastTickTs = lastTick?.ts ?? null;
      const heartbeatAgeMs = lastTickTs
        ? Math.max(0, RuntimeClock.now() - new Date(lastTickTs).getTime())
        : null;

      const schedulerSnap = scheduler?.snapshot?.() as
        | { agendas?: unknown[] }
        | undefined;
      const schedulerAgendas = Array.isArray(schedulerSnap?.agendas)
        ? schedulerSnap!.agendas!.length
        : 0;

      const probe: SystemHealthProbe = {
        runtimeUptimeMs: lastTick?.uptimeMs ?? 0,
        registeredAgents: registry.size(),
        healthyAgents: registry.healthyCount(),
        adapters: 0,
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
      const result: ExecutionResult = {
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
      return result;
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

  async cleanup(ctx: ExecutionContext): Promise<void> {
    // Etapa 9: publica APÓS execute + cleanup, best-effort.
    // Só publica se: probe válido, sem erro, adapter real, contexto disponível.
    if (this.lastError !== null) return;
    const probe = this.lastProbe;
    if (!probe) return;
    const shared = ctx.runtime.context ?? null;
    if (!shared) return;

    this.publisherStats.connected = true;
    try {
      const queueBound = probe.queueBound;
      const level = healthLevelFrom(probe);
      const metadata = {
        runtimeOnline: true,
        runtimeUptimeSeconds: Math.floor(probe.runtimeUptimeMs / 1000),
        registeredAgents: probe.registeredAgents,
        healthyAgents: probe.healthyAgents,
        disabledAgents: Math.max(0, probe.registeredAgents - probe.healthyAgents),
        heartbeatAgeSeconds:
          probe.heartbeatAgeMs === null ? null : Math.floor(probe.heartbeatAgeMs / 1000),
        registeredSchedules: probe.schedulerAgendas,
        enabledSchedules: probe.schedulerAgendas,
        queuedJobs: queueBound ? 0 : 0,
        processingJobs: 0,
        failedJobs: 0,
        healthLevel: level,
      } as const;
      const payloadHash = stableHash(metadata);
      const envelope = shared.publisher.replace({
        id: `system-health::${ctx.tenantId}`,
        topic: "system-health",
        agentId: this.agentId,
        tenantId: ctx.tenantId,
        version: this.publisherStats.publishCount + 1,
        priority: "critical",
        ttlMs: SYSTEM_HEALTH_TTL_MS,
        confidence: 1,
        payloadHash,
        metadata,
      });
      this.publisherStats.publishCount += 1;
      this.publisherStats.lastPublishedAtMs = RuntimeClock.now();
      this.publisherStats.lastError = null;
      this.publisherStats.lastEnvelopeId = envelope.id;
      this.publisherStats.lastExpiresAt = envelope.expiresAt;
      this.publisherStats.lastTenantId = ctx.tenantId;
    } catch (e) {
      // Best-effort: NUNCA propaga erro, apenas registra warning sanitizado.
      const msg = e instanceof Error ? e.message : "publish_error";
      this.publisherStats.publishErrors += 1;
      this.publisherStats.lastError = msg.slice(0, 120);
    }
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

  publisherSnapshot(): SystemHealthPublisherStats {
    return { ...this.publisherStats };
  }
}
