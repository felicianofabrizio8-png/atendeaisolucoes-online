// ============================================================================
// AutonomousRuntime — Ponto central do sistema nervoso.
// Etapa 2: agora controla a fila (Dispatcher + Queue). NÃO executa agentes.
// Stateless multi-tenant: nunca armazena contexto de empresa.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { AgentDispatcher } from "./AgentDispatcher.server";
import { AgentOrchestrator } from "./AgentOrchestrator.server";
import { AgentRegistry } from "./AgentRegistry.server";
import { RuntimeClock } from "./RuntimeClock.server";
import { RuntimeHeartbeat } from "./RuntimeHeartbeat.server";
import { RuntimeJobQueue } from "./RuntimeJobQueue.server";
import { RuntimeScheduler } from "./RuntimeScheduler.server";
import { SchedulerRegistry } from "./SchedulerRegistry.server";
import { RUNTIME_VERSION, type RuntimeJobCounters, type RuntimeStatus } from "./RuntimeTypes";

export class AutonomousRuntime {
  readonly scheduler: RuntimeScheduler;
  readonly registry: AgentRegistry;
  readonly orchestrator: AgentOrchestrator;
  readonly heartbeat: RuntimeHeartbeat;
  readonly startedAtMs: number;
  readonly startedAtIso: string;

  private _queue: RuntimeJobQueue | null = null;
  private _dispatcher: AgentDispatcher;

  private static _instance: AutonomousRuntime | null = null;

  private constructor() {
    this.startedAtMs = RuntimeClock.now();
    this.startedAtIso = new Date(this.startedAtMs).toISOString();
    this.registry = new AgentRegistry();
    this.orchestrator = new AgentOrchestrator(this.registry);
    this.heartbeat = new RuntimeHeartbeat(this.registry, this.startedAtMs);
    this._dispatcher = new AgentDispatcher({
      registry: this.registry,
      orchestrator: this.orchestrator,
      queue: null,
    });
    this.scheduler = new RuntimeScheduler(new SchedulerRegistry(), this._dispatcher);
    // Primeiro tick sincrônico (sem banco).
    this.heartbeat.tick();
  }

  static instance(): AutonomousRuntime {
    if (!AutonomousRuntime._instance) {
      AutonomousRuntime._instance = new AutonomousRuntime();
    }
    return AutonomousRuntime._instance;
  }

  /** Conecta o Runtime a um cliente Supabase admin (writer). Idempotente. */
  bindWriter(writer: SupabaseClient<Database>): void {
    this._queue = new RuntimeJobQueue(writer);
    this._dispatcher = new AgentDispatcher({
      registry: this.registry,
      orchestrator: this.orchestrator,
      queue: this._queue,
    });
    (this.scheduler as unknown as { dispatcher: AgentDispatcher })["dispatcher"] = this._dispatcher;
  }

  get dispatcher(): AgentDispatcher {
    return this._dispatcher;
  }

  get queue(): RuntimeJobQueue | null {
    return this._queue;
  }

  status(): RuntimeStatus {
    return {
      online: true,
      version: RUNTIME_VERSION,
      startedAt: this.startedAtIso,
      uptimeMs: RuntimeClock.since(this.startedAtMs),
      registeredAgents: this.registry.size(),
      healthyAgents: this.registry.healthyCount(),
      disabledAgents: this.registry.disabledCount(),
      lastHeartbeat: this.heartbeat.last(),
    };
  }

  async fullSnapshot(tenantId?: string) {
    const counters: RuntimeJobCounters | null = this._queue
      ? await this._queue.counters(tenantId).catch(() => null)
      : null;
    const tick = await this.heartbeat.tickWithQueue(this._queue, tenantId);
    const recentJobs = this._queue
      ? await this._queue.list({ tenantId, limit: 25 }).catch(() => [])
      : [];
    return {
      status: this.status(),
      heartbeat: tick,
      counters,
      agents: this.registry.list().map((a) => ({
        id: a.descriptor.id,
        name: a.descriptor.name,
        category: a.descriptor.category,
        enabled: a.descriptor.enabled,
        executionMode: a.descriptor.executionMode,
        supportedExecutionModes: a.descriptor.supportedExecutionModes,
        supportedPriorities: a.descriptor.supportedPriorities,
        maxConcurrency: a.descriptor.maxConcurrency,
        retryPolicy: a.descriptor.retryPolicy,
        timeoutPolicy: a.descriptor.timeoutPolicy,
        priority: a.descriptor.priority,
        dependencies: a.descriptor.dependencies,
        state: a.state,
      })),
      recentJobs,
    };
  }

  static __resetForTests(): void {
    AutonomousRuntime._instance?.heartbeat.stop();
    AutonomousRuntime._instance = null;
  }
}
