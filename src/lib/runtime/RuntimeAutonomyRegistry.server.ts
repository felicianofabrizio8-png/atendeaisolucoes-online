// ============================================================================
// RuntimeAutonomyRegistry — FASE 2 (Etapa 17): suporta system-health + business-brain.
//
// A autonomia por tenant e o kill switch ficam em `company_settings`
// (via RuntimeStateStore). Métricas de tick/jobs em memória APENAS para
// observabilidade — nunca decidem execução.
// ============================================================================

import {
  getRuntimeFlags,
  listAutonomyEnabledTenants,
  invalidateFlagsCache,
} from "./RuntimeStateStore.server";

export type AutonomyAgentKey = "system-health" | "business-brain";

interface AutonomyMetrics {
  lastTickAt: string | null;
  lastTickTenants: string[];
  lastTickReason: string | null;
  ticksReceived: number;
  ticksRejected: number;
  duplicatesPrevented: number;
  jobsCreated: number;
  jobsCompleted: number;
  jobsFailed: number;
}

function emptyMetrics(): AutonomyMetrics {
  return {
    lastTickAt: null,
    lastTickTenants: [],
    lastTickReason: null,
    ticksReceived: 0,
    ticksRejected: 0,
    duplicatesPrevented: 0,
    jobsCreated: 0,
    jobsCompleted: 0,
    jobsFailed: 0,
  };
}

const METRICS: Record<AutonomyAgentKey, AutonomyMetrics> = {
  "system-health": emptyMetrics(),
  "business-brain": emptyMetrics(),
};

// Intervalo por agente (bucket em segundos)
const INTERVALS: Record<AutonomyAgentKey, number> = {
  "system-health": 300, // 5 min
  "business-brain": 3600, // 60 min (Etapa 17)
};

export class RuntimeAutonomyRegistry {
  /** Retro-compat: intervalo do system-health (5 min). */
  static readonly INTERVAL_SECONDS = 300;

  static intervalSeconds(agent: AutonomyAgentKey): number {
    return INTERVALS[agent];
  }

  /** Verifica no banco (com cache 30s) se o tenant está elegível para autonomia. */
  static async isEnabled(agent: AutonomyAgentKey, tenantId: string): Promise<boolean> {
    const f = await getRuntimeFlags(tenantId);
    if (!f.autonomyEnabled || !f.schedulerEnabled || f.killSwitch) return false;
    if (agent === "system-health") return f.systemHealthEnabled;
    if (agent === "business-brain") return f.businessBrainEnabled;
    return false;
  }

  /** Lista tenants elegíveis (batch — sem N+1). */
  static async enabledTenants(agent: AutonomyAgentKey): Promise<string[]> {
    return listAutonomyEnabledTenants(agent);
  }

  /** Invalida cache local de flags após mudança admin. */
  static invalidateCache(tenantId?: string): void {
    invalidateFlagsCache(tenantId);
  }

  static bucketFor(nowMs: number = Date.now(), agent: AutonomyAgentKey = "system-health"): number {
    return Math.floor(nowMs / (INTERVALS[agent] * 1000));
  }

  static dedupeKey(agent: AutonomyAgentKey, tenantId: string, bucket?: number): string {
    return `autonomy:${agent}:${tenantId}:${bucket ?? this.bucketFor(Date.now(), agent)}`;
  }

  static recordTick(agent: AutonomyAgentKey, tenants: string[], reason: string): void {
    const m = METRICS[agent];
    m.ticksReceived += 1;
    m.lastTickAt = new Date().toISOString();
    m.lastTickTenants = tenants;
    m.lastTickReason = reason;
  }

  static recordTickRejected(agent: AutonomyAgentKey): void {
    METRICS[agent].ticksRejected += 1;
  }

  static recordJobCreated(agent: AutonomyAgentKey): void {
    METRICS[agent].jobsCreated += 1;
  }

  static recordDuplicatePrevented(agent: AutonomyAgentKey): void {
    METRICS[agent].duplicatesPrevented += 1;
  }

  static recordJobCompleted(agent: AutonomyAgentKey, ok: boolean): void {
    const m = METRICS[agent];
    if (ok) m.jobsCompleted += 1;
    else m.jobsFailed += 1;
  }

  /** Snapshot observacional. `tenants` é resolvido de forma assíncrona. */
  static async snapshot(agent: AutonomyAgentKey) {
    const m = METRICS[agent];
    const tenantIds = await this.enabledTenants(agent);
    const interval = INTERVALS[agent];
    return {
      agent,
      intervalSeconds: interval,
      enabledTenantCount: tenantIds.length,
      tenants: tenantIds.map((t) => ({ tenantId: t, source: "persisted", enabled: true })),
      lastTickAt: m.lastTickAt,
      lastTickTenants: m.lastTickTenants,
      lastTickReason: m.lastTickReason,
      ticksReceived: m.ticksReceived,
      ticksRejected: m.ticksRejected,
      duplicatesPrevented: m.duplicatesPrevented,
      jobsCreated: m.jobsCreated,
      jobsCompleted: m.jobsCompleted,
      jobsFailed: m.jobsFailed,
      nextBucketAt: new Date(
        (this.bucketFor(Date.now(), agent) + 1) * interval * 1000,
      ).toISOString(),
      secretConfigured: Boolean(process.env.RUNTIME_TICK_SECRET),
      source: "persisted" as const,
    };
  }
}
