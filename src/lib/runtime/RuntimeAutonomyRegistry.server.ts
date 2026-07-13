// ============================================================================
// RuntimeAutonomyRegistry — FASE 2: fonte de verdade persistida.
//
// A autonomia por tenant e o kill switch agora ficam em `company_settings`
// (via RuntimeStateStore). Métricas de tick/jobs continuam em memória
// APENAS para observabilidade — nunca decidem execução.
// ============================================================================

import {
  getRuntimeFlags,
  listAutonomyEnabledTenants,
  invalidateFlagsCache,
} from "./RuntimeStateStore.server";

export type AutonomyAgentKey = "system-health";

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

const METRICS: Record<AutonomyAgentKey, AutonomyMetrics> = {
  "system-health": {
    lastTickAt: null,
    lastTickTenants: [],
    lastTickReason: null,
    ticksReceived: 0,
    ticksRejected: 0,
    duplicatesPrevented: 0,
    jobsCreated: 0,
    jobsCompleted: 0,
    jobsFailed: 0,
  },
};

export class RuntimeAutonomyRegistry {
  static readonly INTERVAL_SECONDS = 300; // 5 min bucket

  /** Verifica no banco (com cache 30s) se o tenant está elegível para autonomia. */
  static async isEnabled(agent: AutonomyAgentKey, tenantId: string): Promise<boolean> {
    if (agent !== "system-health") return false;
    const f = await getRuntimeFlags(tenantId);
    return (
      f.autonomyEnabled &&
      f.systemHealthEnabled &&
      f.schedulerEnabled &&
      f.killSwitch === false
    );
  }

  /** Lista tenants elegíveis (batch — sem N+1). */
  static async enabledTenants(agent: AutonomyAgentKey): Promise<string[]> {
    if (agent !== "system-health") return [];
    return listAutonomyEnabledTenants();
  }

  /** Invalida cache local de flags após mudança admin. */
  static invalidateCache(tenantId?: string): void {
    invalidateFlagsCache(tenantId);
  }

  static bucketFor(nowMs: number = Date.now()): number {
    return Math.floor(nowMs / (this.INTERVAL_SECONDS * 1000));
  }

  static dedupeKey(agent: AutonomyAgentKey, tenantId: string, bucket?: number): string {
    return `autonomy:${agent}:${tenantId}:${bucket ?? this.bucketFor()}`;
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
    return {
      agent,
      intervalSeconds: this.INTERVAL_SECONDS,
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
        (this.bucketFor() + 1) * this.INTERVAL_SECONDS * 1000,
      ).toISOString(),
      secretConfigured: Boolean(process.env.RUNTIME_TICK_SECRET),
      source: "persisted" as const,
    };
  }
}
