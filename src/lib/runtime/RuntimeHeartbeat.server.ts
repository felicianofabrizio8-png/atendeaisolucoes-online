// ============================================================================
// RuntimeHeartbeat — Batimento interno do Runtime.
// Etapa 2: inclui contadores da Job Queue. NÃO dispara agentes.
// O loop com setInterval NÃO é iniciado automaticamente.
// ============================================================================

import { RuntimeClock } from "./RuntimeClock.server";
import type { AgentRegistry } from "./AgentRegistry.server";
import type { RuntimeJobQueue } from "./RuntimeJobQueue.server";
import { EMPTY_JOB_COUNTERS } from "./RuntimeJobQueue.server";
import type { HeartbeatTick, RuntimeJobCounters } from "./RuntimeTypes";

export const HEARTBEAT_INTERVAL_MS = 30_000;

export class RuntimeHeartbeat {
  private lastTick: HeartbeatTick | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly startedAtMs: number,
  ) {}

  /** Registra um tick sincrônico (sem tocar em banco). */
  tick(counters: RuntimeJobCounters = EMPTY_JOB_COUNTERS): HeartbeatTick {
    this.lastTick = {
      ts: RuntimeClock.nowIso(),
      uptimeMs: RuntimeClock.since(this.startedAtMs),
      registeredAgents: this.registry.size(),
      healthyAgents: this.registry.healthyCount(),
      disabledAgents: this.registry.disabledCount(),
      jobs: counters,
    };
    return this.lastTick;
  }

  async tickWithQueue(queue: RuntimeJobQueue | null, tenantId?: string): Promise<HeartbeatTick> {
    if (!queue) return this.tick();
    try {
      const counters = await queue.counters(tenantId);
      return this.tick(counters);
    } catch {
      return this.tick();
    }
  }

  last(): HeartbeatTick | null {
    return this.lastTick;
  }

  /** Uso opcional (nunca iniciado automaticamente). */
  start(intervalMs: number = HEARTBEAT_INTERVAL_MS): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
