// ============================================================================
// RuntimeHeartbeat — Batimento interno do Runtime.
// Etapa 1: apenas registra ticks in-memory. NÃO dispara agentes.
// O loop com setInterval NÃO é iniciado automaticamente; deve ser chamado
// explicitamente por testes/observabilidade (evita side-effects em SSR).
// ============================================================================

import { RuntimeClock } from "./RuntimeClock.server";
import type { AgentRegistry } from "./AgentRegistry.server";
import type { HeartbeatTick } from "./RuntimeTypes";

export const HEARTBEAT_INTERVAL_MS = 30_000;

export class RuntimeHeartbeat {
  private lastTick: HeartbeatTick | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly startedAtMs: number,
  ) {}

  /** Registra um tick imediatamente e retorna o snapshot. */
  tick(): HeartbeatTick {
    const registered = this.registry.size();
    const healthy = this.registry.healthyCount();
    const disabled = this.registry.disabledCount();
    this.lastTick = {
      ts: RuntimeClock.nowIso(),
      uptimeMs: RuntimeClock.since(this.startedAtMs),
      registeredAgents: registered,
      healthyAgents: healthy,
      disabledAgents: disabled,
    };
    return this.lastTick;
  }

  last(): HeartbeatTick | null {
    return this.lastTick;
  }

  /** Uso opcional (nunca iniciado automaticamente na Etapa 1). */
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
