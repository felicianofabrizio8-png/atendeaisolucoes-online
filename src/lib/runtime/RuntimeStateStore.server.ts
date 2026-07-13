// ============================================================================
// RuntimeStateStore — Fonte de verdade PERSISTIDA para Runtime.
//
// Persiste em Postgres:
//  - Flags de autonomia por tenant (company_settings.runtime_*)
//  - Dedupe distribuído (runtime_dedupe, UNIQUE constraint)
//  - Locks distribuídos (runtime_locks, TTL + owner)
//  - Rate limit distribuído (rate_limit_counters, INSERT ... ON CONFLICT DO UPDATE)
//  - Auditoria técnica (runtime_audit)
//
// Cache local (por isolate) apenas com TTL curto (30s). Banco é soberano.
// Falha de leitura => fail-closed (autonomia desligada, dedupe rejeita).
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ---------------------------------------------------------------------------
// Tipagem defensiva (o tipo gerado do banco pode não incluir as novidades).
// ---------------------------------------------------------------------------
type RpcClient = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
type Admin = typeof supabaseAdmin & Record<string, unknown>;
function rpc(): RpcClient {
  return (supabaseAdmin as Admin).rpc as unknown as RpcClient;
}

// ---------------------------------------------------------------------------
// Flags de runtime
// ---------------------------------------------------------------------------
export interface RuntimeFlags {
  autonomyEnabled: boolean;
  systemHealthEnabled: boolean;
  killSwitch: boolean;
  schedulerEnabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

const FLAG_CACHE_TTL_MS = 30_000;
const flagsCache = new Map<string, { value: RuntimeFlags; expiresAt: number }>();

const FLAG_DEFAULTS: RuntimeFlags = {
  autonomyEnabled: false,
  systemHealthEnabled: false,
  killSwitch: true, // fail-closed
  schedulerEnabled: false,
  updatedAt: null,
  updatedBy: null,
};

export async function getRuntimeFlags(tenantId: string): Promise<RuntimeFlags> {
  const now = Date.now();
  const cached = flagsCache.get(tenantId);
  if (cached && cached.expiresAt > now) return cached.value;

  try {
    const { data, error } = await supabaseAdmin
      .from("company_settings")
      // Colunas novas — o tipo gerado ainda não as expõe. Cast para any local.
      .select(
        "runtime_autonomy_enabled, runtime_system_health_enabled, runtime_kill_switch, runtime_scheduler_enabled, runtime_updated_at, runtime_updated_by" as unknown as "*",
      )
      .eq("company_id", tenantId)
      .maybeSingle();
    if (error) throw error;
    const row = (data ?? {}) as Record<string, unknown>;
    const value: RuntimeFlags = {
      autonomyEnabled: Boolean(row.runtime_autonomy_enabled) || false,
      systemHealthEnabled: Boolean(row.runtime_system_health_enabled) || false,
      // fail-closed: se coluna nula, kill switch é considerado ligado
      killSwitch: row.runtime_kill_switch === false ? false : true,
      schedulerEnabled: Boolean(row.runtime_scheduler_enabled) || false,
      updatedAt: (row.runtime_updated_at as string | null) ?? null,
      updatedBy: (row.runtime_updated_by as string | null) ?? null,
    };
    flagsCache.set(tenantId, { value, expiresAt: now + FLAG_CACHE_TTL_MS });
    return value;
  } catch {
    // Fail-closed: retorna defaults conservadores, NÃO cacheia.
    return { ...FLAG_DEFAULTS };
  }
}

export interface FlagUpdate {
  systemHealthEnabled?: boolean;
  killSwitch?: boolean;
  actorId: string;
  correlationId: string;
}

export async function updateRuntimeFlags(
  tenantId: string,
  update: FlagUpdate,
): Promise<{ ok: boolean; flags: RuntimeFlags; before: RuntimeFlags }> {
  const before = await getRuntimeFlags(tenantId);
  const patch: Record<string, unknown> = {
    runtime_updated_at: new Date().toISOString(),
    runtime_updated_by: update.actorId,
  };
  if (typeof update.systemHealthEnabled === "boolean") {
    patch.runtime_system_health_enabled = update.systemHealthEnabled;
    // Autonomia é implícita se algum agente está habilitado.
    patch.runtime_autonomy_enabled = update.systemHealthEnabled;
    patch.runtime_scheduler_enabled = update.systemHealthEnabled;
  }
  if (typeof update.killSwitch === "boolean") {
    patch.runtime_kill_switch = update.killSwitch;
  }

  const { error } = await supabaseAdmin
    .from("company_settings")
    .update(patch as never)
    .eq("company_id", tenantId);
  if (error) {
    return { ok: false, flags: before, before };
  }

  // Invalida cache local imediatamente.
  flagsCache.delete(tenantId);
  const after = await getRuntimeFlags(tenantId);

  // Auditoria
  await supabaseAdmin
    .from("runtime_audit" as never)
    .insert({
      company_id: tenantId,
      actor_id: update.actorId,
      action: "flags_updated",
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      correlation_id: update.correlationId,
    } as never)
    .then(
      () => undefined,
      () => undefined,
    );

  return { ok: true, flags: after, before };
}

export function invalidateFlagsCache(tenantId?: string): void {
  if (tenantId) flagsCache.delete(tenantId);
  else flagsCache.clear();
}

// ---------------------------------------------------------------------------
// Lista de tenants com system-health habilitado (batch, sem N+1)
// ---------------------------------------------------------------------------
export async function listAutonomyEnabledTenants(): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("company_settings")
      .select("company_id, runtime_system_health_enabled, runtime_kill_switch, runtime_autonomy_enabled, runtime_scheduler_enabled" as unknown as "*")
      .eq("runtime_system_health_enabled" as never, true as never)
      .eq("runtime_autonomy_enabled" as never, true as never)
      .eq("runtime_scheduler_enabled" as never, true as never)
      .eq("runtime_kill_switch" as never, false as never);
    if (error) throw error;
    return (data ?? [])
      .map((r) => (r as Record<string, unknown>).company_id)
      .filter((v): v is string => typeof v === "string");
  } catch {
    // Fail-closed
    return [];
  }
}

// ---------------------------------------------------------------------------
// Dedupe distribuído
// ---------------------------------------------------------------------------
export async function tryDedupe(params: {
  operation: string;
  resourceKey: string;
  bucket: number;
  ttlSeconds: number;
  companyId?: string | null;
}): Promise<boolean> {
  try {
    const { data, error } = await rpc()("runtime_try_dedupe", {
      _operation: params.operation,
      _resource_key: params.resourceKey,
      _bucket: params.bucket,
      _ttl_seconds: params.ttlSeconds,
      _company_id: params.companyId ?? null,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false; // fail-closed
  }
}

// ---------------------------------------------------------------------------
// Locks distribuídos
// ---------------------------------------------------------------------------
export async function tryAcquireLock(params: {
  lockKey: string;
  ownerId: string;
  ttlSeconds: number;
  companyId?: string | null;
}): Promise<boolean> {
  try {
    const { data, error } = await rpc()("runtime_try_acquire_lock", {
      _lock_key: params.lockKey,
      _owner_id: params.ownerId,
      _ttl_seconds: params.ttlSeconds,
      _company_id: params.companyId ?? null,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

export async function releaseLock(lockKey: string, ownerId: string): Promise<void> {
  try {
    await rpc()("runtime_release_lock", { _lock_key: lockKey, _owner_id: ownerId });
  } catch {
    /* silencioso */
  }
}

// ---------------------------------------------------------------------------
// Rate limit distribuído (reutiliza public.rate_limit_counters)
// ---------------------------------------------------------------------------
export async function rateLimitIncrement(params: {
  companyId: string | null;
  bucket: string;
  windowSeconds: number;
}): Promise<{ allowed: boolean; count: number }> {
  const nowMs = Date.now();
  const windowStartMs = Math.floor(nowMs / (params.windowSeconds * 1000)) * params.windowSeconds * 1000;
  const windowStart = new Date(windowStartMs).toISOString();
  try {
    const { data, error } = await rpc()("rate_limit_increment", {
      _company_id: params.companyId ?? "00000000-0000-0000-0000-000000000000",
      _bucket: params.bucket,
      _window_start: windowStart,
      _window_seconds: params.windowSeconds,
      _increment: 1,
    });
    if (error || typeof data !== "number") return { allowed: true, count: 0 };
    return { allowed: true, count: data };
  } catch {
    return { allowed: true, count: 0 };
  }
}

/** Retorna true se o limite AINDA não foi atingido após o incremento. */
export async function rateLimitCheck(params: {
  companyId: string | null;
  bucket: string;
  windowSeconds: number;
  max: number;
}): Promise<boolean> {
  const { count } = await rateLimitIncrement({
    companyId: params.companyId,
    bucket: params.bucket,
    windowSeconds: params.windowSeconds,
  });
  return count <= params.max;
}

// ---------------------------------------------------------------------------
// Auditoria técnica agregada (contagens/códigos, sem PII)
// ---------------------------------------------------------------------------
export async function auditRuntimeEvent(params: {
  companyId?: string | null;
  actorId?: string | null;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  correlationId?: string | null;
}): Promise<void> {
  try {
    await supabaseAdmin.from("runtime_audit" as never).insert({
      company_id: params.companyId ?? null,
      actor_id: params.actorId ?? null,
      action: params.action,
      before: params.before ?? null,
      after: params.after ?? null,
      correlation_id: params.correlationId ?? null,
    } as never);
  } catch {
    /* silencioso — auditoria nunca quebra fluxo */
  }
}
