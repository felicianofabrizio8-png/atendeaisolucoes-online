// ============================================================================
// RuntimeAutonomyRegistry — Feature-flag por tenant para AUTONOMIA controlada.
// Etapa 15: apenas system-health é elegível.
// Fonte de verdade primária: env var RUNTIME_AUTONOMY_SYSTEM_HEALTH_TENANTS
// (lista separada por vírgulas de UUIDs). Overrides em memória podem
// habilitar/desabilitar tenants em tempo de execução (kill switch imediato).
// ============================================================================

export type AutonomyAgentKey = "system-health";

interface AutonomyState {
  seededFromEnv: Set<string>;
  overrides: Map<string, boolean>; // tenantId -> enabled
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

const STATE: Record<AutonomyAgentKey, AutonomyState> = {
  "system-health": {
    seededFromEnv: new Set<string>(),
    overrides: new Map<string, boolean>(),
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

let _seeded = false;
function seedFromEnv(): void {
  if (_seeded) return;
  _seeded = true;
  const raw = process.env.RUNTIME_AUTONOMY_SYSTEM_HEALTH_TENANTS ?? "";
  raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((id) => STATE["system-health"].seededFromEnv.add(id));
}

export class RuntimeAutonomyRegistry {
  static readonly INTERVAL_SECONDS = 300; // 5 min bucket

  static isEnabled(agent: AutonomyAgentKey, tenantId: string): boolean {
    seedFromEnv();
    const s = STATE[agent];
    if (s.overrides.has(tenantId)) return s.overrides.get(tenantId)!;
    return s.seededFromEnv.has(tenantId);
  }

  static enabledTenants(agent: AutonomyAgentKey): string[] {
    seedFromEnv();
    const s = STATE[agent];
    const all = new Set<string>(s.seededFromEnv);
    for (const [t, v] of s.overrides.entries()) {
      if (v) all.add(t);
      else all.delete(t);
    }
    return Array.from(all);
  }

  static setOverride(agent: AutonomyAgentKey, tenantId: string, enabled: boolean): void {
    seedFromEnv();
    STATE[agent].overrides.set(tenantId, enabled);
  }

  static clearOverride(agent: AutonomyAgentKey, tenantId: string): void {
    STATE[agent].overrides.delete(tenantId);
  }

  /** Global kill switch: desabilita para TODOS os tenants habilitados. */
  static killAll(agent: AutonomyAgentKey): void {
    seedFromEnv();
    const s = STATE[agent];
    for (const t of s.seededFromEnv) s.overrides.set(t, false);
    for (const [t] of s.overrides) s.overrides.set(t, false);
  }

  static bucketFor(nowMs: number = Date.now()): number {
    return Math.floor(nowMs / (this.INTERVAL_SECONDS * 1000));
  }

  static dedupeKey(agent: AutonomyAgentKey, tenantId: string, bucket?: number): string {
    return `autonomy:${agent}:${tenantId}:${bucket ?? this.bucketFor()}`;
  }

  static recordTick(agent: AutonomyAgentKey, tenants: string[], reason: string): void {
    const s = STATE[agent];
    s.ticksReceived += 1;
    s.lastTickAt = new Date().toISOString();
    s.lastTickTenants = tenants;
    s.lastTickReason = reason;
  }

  static recordTickRejected(agent: AutonomyAgentKey): void {
    STATE[agent].ticksRejected += 1;
  }

  static recordJobCreated(agent: AutonomyAgentKey): void {
    STATE[agent].jobsCreated += 1;
  }

  static recordDuplicatePrevented(agent: AutonomyAgentKey): void {
    STATE[agent].duplicatesPrevented += 1;
  }

  static recordJobCompleted(agent: AutonomyAgentKey, ok: boolean): void {
    const s = STATE[agent];
    if (ok) s.jobsCompleted += 1;
    else s.jobsFailed += 1;
  }

  static snapshot(agent: AutonomyAgentKey) {
    seedFromEnv();
    const s = STATE[agent];
    const tenants = this.enabledTenants(agent).map((t) => ({
      tenantId: t,
      source: s.seededFromEnv.has(t) ? "env" : "override",
      enabled: this.isEnabled(agent, t),
    }));
    return {
      agent,
      intervalSeconds: this.INTERVAL_SECONDS,
      enabledTenantCount: tenants.length,
      tenants,
      lastTickAt: s.lastTickAt,
      lastTickTenants: s.lastTickTenants,
      lastTickReason: s.lastTickReason,
      ticksReceived: s.ticksReceived,
      ticksRejected: s.ticksRejected,
      duplicatesPrevented: s.duplicatesPrevented,
      jobsCreated: s.jobsCreated,
      jobsCompleted: s.jobsCompleted,
      jobsFailed: s.jobsFailed,
      nextBucketAt: new Date(
        (this.bucketFor() + 1) * this.INTERVAL_SECONDS * 1000,
      ).toISOString(),
      secretConfigured: Boolean(process.env.RUNTIME_TICK_SECRET),
    };
  }
}
