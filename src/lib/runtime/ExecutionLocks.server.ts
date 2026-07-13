// ============================================================================
// ExecutionLocks — Contratos in-memory para impedir execução dupla.
// Escopo: mesmo (tenant, agente, bucket). Não distribuído.
// ============================================================================

import { RuntimeClock } from "./RuntimeClock.server";

export interface LockHandle {
  key: string;
  acquiredAt: string;
  ttlMs: number;
  release: () => void;
}

export interface LockAcquireResult {
  acquired: boolean;
  reason: string;
  handle: LockHandle | null;
}

interface LockEntry {
  key: string;
  expiresAtMs: number;
  acquiredAtIso: string;
}

export class ExecutionLocks {
  private readonly locks = new Map<string, LockEntry>();
  private acquiredCount = 0;
  private rejectedCount = 0;
  private releasedCount = 0;
  private expiredCount = 0;

  static buildKey(tenantId: string, agentId: string, bucket: string | number): string {
    return `lock:${tenantId}:${agentId}:${bucket}`;
  }

  acquire(key: string, ttlMs: number): LockAcquireResult {
    const now = RuntimeClock.now();
    const existing = this.locks.get(key);
    if (existing) {
      if (existing.expiresAtMs > now) {
        this.rejectedCount += 1;
        return { acquired: false, reason: "lock_busy", handle: null };
      }
      this.expiredCount += 1;
      this.locks.delete(key);
    }
    const entry: LockEntry = {
      key,
      expiresAtMs: now + Math.max(1000, ttlMs),
      acquiredAtIso: new Date(now).toISOString(),
    };
    this.locks.set(key, entry);
    this.acquiredCount += 1;
    return {
      acquired: true,
      reason: "acquired",
      handle: {
        key,
        acquiredAt: entry.acquiredAtIso,
        ttlMs,
        release: () => this.release(key),
      },
    };
  }

  release(key: string): boolean {
    const ok = this.locks.delete(key);
    if (ok) this.releasedCount += 1;
    return ok;
  }

  active(): number {
    const now = RuntimeClock.now();
    let n = 0;
    for (const l of this.locks.values()) if (l.expiresAtMs > now) n += 1;
    return n;
  }

  snapshot() {
    return {
      active: this.active(),
      acquired: this.acquiredCount,
      rejected: this.rejectedCount,
      released: this.releasedCount,
      expired: this.expiredCount,
    };
  }
}
