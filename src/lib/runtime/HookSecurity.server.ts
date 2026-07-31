// ============================================================================
// HookSecurity — utilidades comuns para endpoints públicos server-to-server.
// - Comparação timing-safe de secrets.
// - Rate limit em memória (best-effort, por isolate).
// - Lock técnico para execução única concorrente.
// - Dedupe por chave + bucket.
//
// Uso restrito a hooks internos (agent-trigger, followup-tick). Não altera
// nenhum módulo operacional.
// ============================================================================

// Primitivas compartilhadas (Sprint 7 — Fase 7.2). A API pública deste
// módulo permanece idêntica: os consumidores continuam importando
// `safeEqualSecret` e `correlationId` daqui.
export { safeEqualSecret } from "@/lib/shared/secure-compare.server";
export { correlationId } from "@/lib/shared/correlation";

// ---------------------------------------------------------------------------
// Rate limit por chave (janela deslizante simples em memória).
// ---------------------------------------------------------------------------
const rateBuckets = new Map<string, number[]>();

export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
): { allowed: boolean; remaining: number } {
  const arr = rateBuckets.get(key) ?? [];
  const cutoff = now - windowMs;
  const kept = arr.filter((t) => t > cutoff);
  if (kept.length >= max) {
    rateBuckets.set(key, kept);
    return { allowed: false, remaining: 0 };
  }
  kept.push(now);
  rateBuckets.set(key, kept);
  return { allowed: true, remaining: Math.max(0, max - kept.length) };
}

// ---------------------------------------------------------------------------
// Lock técnico (uma execução por chave) — com TTL para evitar vazamento
// quando a request é abortada antes do finally (ex.: pg_net timeout ~30s
// enquanto o worker faz polling da Meta). API pública preservada: se o
// consumidor não informar ttlMs, o default é usado.
// ---------------------------------------------------------------------------
interface LockEntry {
  acquiredAt: number;
  expiresAt: number;
}
const activeLocks = new Map<string, LockEntry>();

// TTL default: 120s. Justificativa: pollContainerReady pode chegar a ~50s,
// somado a upload/publish; margem conservadora acima do cron minute-based
// e do timeout do pg_net (~30s) para não bloquear os próximos ticks.
export const DEFAULT_LOCK_TTL_MS = 120_000;

export function tryAcquireLock(
  key: string,
  ttlMs: number = DEFAULT_LOCK_TTL_MS,
  now: number = Date.now(),
): boolean {
  const existing = activeLocks.get(key);
  if (existing && existing.expiresAt > now) {
    return false;
  }
  if (existing) {
    // Lock vazado: request anterior morreu antes do finally.
    console.warn("[hook-security] lock_recovered_expired", {
      key,
      age_ms: now - existing.acquiredAt,
    });
  }
  activeLocks.set(key, { acquiredAt: now, expiresAt: now + ttlMs });
  return true;
}

export function releaseLock(key: string): void {
  activeLocks.delete(key);
}

/** Uso EXCLUSIVO em testes. */
export function __resetLocksForTests(): void {
  activeLocks.clear();
}

// ---------------------------------------------------------------------------
// Dedupe por chave + TTL em memória.
// ---------------------------------------------------------------------------
const dedupeMap = new Map<string, number>();

export function seenRecently(key: string, ttlMs: number, now = Date.now()): boolean {
  const exp = dedupeMap.get(key);
  if (exp && exp > now) return true;
  dedupeMap.set(key, now + ttlMs);
  // limpeza oportunista
  if (dedupeMap.size > 1000) {
    for (const [k, v] of dedupeMap) {
      if (v <= now) dedupeMap.delete(k);
    }
  }
  return false;
}

// Máscara curta para logs (nunca vazar identificadores completos).
export function maskId(id: string | null | undefined): string {
  if (!id) return "-";
  const s = String(id);
  if (s.length <= 8) return `${s.slice(0, 2)}***`;
  return `${s.slice(0, 4)}***${s.slice(-2)}`;
}
