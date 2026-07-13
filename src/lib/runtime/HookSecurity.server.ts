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

import { timingSafeEqual } from "crypto";

export function safeEqualSecret(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

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
// Lock técnico (uma execução por chave).
// ---------------------------------------------------------------------------
const activeLocks = new Set<string>();

export function tryAcquireLock(key: string): boolean {
  if (activeLocks.has(key)) return false;
  activeLocks.add(key);
  return true;
}

export function releaseLock(key: string): void {
  activeLocks.delete(key);
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

export function correlationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Máscara curta para logs (nunca vazar identificadores completos).
export function maskId(id: string | null | undefined): string {
  if (!id) return "-";
  const s = String(id);
  if (s.length <= 8) return `${s.slice(0, 2)}***`;
  return `${s.slice(0, 4)}***${s.slice(-2)}`;
}
