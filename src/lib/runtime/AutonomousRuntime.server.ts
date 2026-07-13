// ============================================================================
// AutonomousRuntime — Ponto central do sistema nervoso.
// Etapa 2: agora controla a fila (Dispatcher + Queue). NÃO executa agentes.
// Stateless multi-tenant: nunca armazena contexto de empresa.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { AgentAdapterRegistry } from "./AgentAdapterRegistry.server";
import { AgentDispatcher } from "./AgentDispatcher.server";
import { AgentOrchestrator } from "./AgentOrchestrator.server";
import { AgentRegistry } from "./AgentRegistry.server";
import { RuntimeClock } from "./RuntimeClock.server";
import { RuntimeExecutionEngine } from "./RuntimeExecutionEngine.server";
import { RuntimeHeartbeat } from "./RuntimeHeartbeat.server";
import { RuntimeJobQueue } from "./RuntimeJobQueue.server";
import { RuntimeScheduler } from "./RuntimeScheduler.server";
import { RuntimeWorker } from "./RuntimeWorker.server";
import { SchedulerRegistry } from "./SchedulerRegistry.server";
import { SystemHealthAdapter } from "./SystemHealthAdapter.server";
import { BusinessBrainAdapter } from "./BusinessBrainAdapter.server";
import { BusinessLearningAdapter } from "./BusinessLearningAdapter.server";
import { ScientificKnowledgeAdapter } from "./ScientificKnowledgeAdapter.server";
import { ScientificMemoryAdapter } from "./ScientificMemoryAdapter.server";
import { ProfessorAdapter } from "./ProfessorAdapter.server";
import { ExecutiveIntelligenceAdapter } from "./ExecutiveIntelligenceAdapter.server";
import { ExecutiveKnowledgeAdapter } from "./ExecutiveKnowledgeAdapter.server";
import { ExecutiveNarrativeAdapter } from "./ExecutiveNarrativeAdapter.server";
import { RUNTIME_VERSION, type RuntimeJobCounters, type RuntimeStatus } from "./RuntimeTypes";

export class AutonomousRuntime {
  readonly scheduler: RuntimeScheduler;
  readonly executionEngine: RuntimeExecutionEngine;
  readonly adapters: AgentAdapterRegistry;
  readonly worker: RuntimeWorker;
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
    this.adapters = new AgentAdapterRegistry(this.registry);
    // Etapa 6: system-health.  Etapa 7: agentes de inteligência conectados.
    // Follow-up, Sales e Coach permanecem StubAgentAdapter.
    this.adapters.register(new SystemHealthAdapter());
    this.adapters.register(new BusinessBrainAdapter());
    this.adapters.register(new BusinessLearningAdapter());
    this.adapters.register(new ScientificKnowledgeAdapter());
    this.adapters.register(new ScientificMemoryAdapter());
    this.adapters.register(new ProfessorAdapter());
    this.adapters.register(new ExecutiveIntelligenceAdapter());
    this.adapters.register(new ExecutiveKnowledgeAdapter());
    this.adapters.register(new ExecutiveNarrativeAdapter());
    this.executionEngine = new RuntimeExecutionEngine({
      registry: this.registry,
      dispatcher: this._dispatcher,
      scheduler: this.scheduler,
      heartbeat: this.heartbeat,
      adapters: this.adapters,
    });
    this.worker = new RuntimeWorker({
      workerId: `worker-${Math.random().toString(36).slice(2, 8)}`,
      queue: null,
      engine: this.executionEngine,
    });
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
    this.executionEngine.rebind({ dispatcher: this._dispatcher });
    this.worker.bindQueue(this._queue);
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
      scheduler: this.scheduler.snapshot(),
      execution: this.executionEngine.snapshot(),
      adapters: this.adapters.snapshot(this.registry),
      worker: this.worker.snapshot(),
      workers: [this.worker.snapshot()],
      systemHealth: {
        allowlist: Array.from(this.executionEngine.allowlist),
        lastExecution: this.executionEngine.lastRealExecution("system-health"),
        adapterHealth: this.adapters.get("system-health")?.health() ?? null,
      },
    };
  }

  static __resetForTests(): void {
    AutonomousRuntime._instance?.heartbeat.stop();
    AutonomousRuntime._instance = null;
  }
}
