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
import { SharedIntelligenceContext } from "./context/SharedIntelligenceContext.server";
import { LearningLoop } from "./LearningLoop.server";
import { RuntimePersistence } from "./RuntimePersistence.server";
import { RUNTIME_VERSION, type RuntimeJobCounters, type RuntimeStatus } from "./RuntimeTypes";

export class AutonomousRuntime {
  readonly scheduler: RuntimeScheduler;
  readonly executionEngine: RuntimeExecutionEngine;
  readonly adapters: AgentAdapterRegistry;
  readonly worker: RuntimeWorker;
  readonly registry: AgentRegistry;
  readonly orchestrator: AgentOrchestrator;
  readonly heartbeat: RuntimeHeartbeat;
  readonly context: SharedIntelligenceContext;
  readonly learningLoop: LearningLoop;
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
    // Etapa 8: Shared Intelligence Context. Construído antes do engine para
    // que adapters possam publicar via ctx.runtime.context (Etapa 9).
    this.context = new SharedIntelligenceContext();
    this.executionEngine = new RuntimeExecutionEngine({
      registry: this.registry,
      dispatcher: this._dispatcher,
      scheduler: this.scheduler,
      heartbeat: this.heartbeat,
      adapters: this.adapters,
      context: this.context,
    });
    this.worker = new RuntimeWorker({
      workerId: `worker-${Math.random().toString(36).slice(2, 8)}`,
      queue: null,
      engine: this.executionEngine,
    });
    // Etapa 14: Learning Loop plugado ao worker. Não executa agentes.
    this.learningLoop = new LearningLoop();
    this.learningLoop.bindContext(this.context);
    this.worker.bindLearningLoop(this.learningLoop);
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
    RuntimePersistence.instance().bindWriter(writer);
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
    const { RuntimeAutonomyRegistry } = await import("./RuntimeAutonomyRegistry.server");
    const [systemHealthSnap, brainSnap, tenantEnabled, tenantEnabledBrain] = await Promise.all([
      RuntimeAutonomyRegistry.snapshot("system-health"),
      RuntimeAutonomyRegistry.snapshot("business-brain"),
      tenantId
        ? RuntimeAutonomyRegistry.isEnabled("system-health", tenantId)
        : Promise.resolve(null),
      tenantId
        ? RuntimeAutonomyRegistry.isEnabled("business-brain", tenantId)
        : Promise.resolve(null),
    ]);
    const autonomy = {
      systemHealth: systemHealthSnap,
      businessBrain: brainSnap,
      tenantEnabled,
      tenantEnabledPerAgent: {
        "system-health": tenantEnabled,
        "business-brain": tenantEnabledBrain,
      },
    };

    const counters: RuntimeJobCounters | null = this._queue
      ? await this._queue.counters(tenantId).catch(() => null)
      : null;
    const tick = await this.heartbeat.tickWithQueue(this._queue, tenantId);
    const recentJobs = this._queue
      ? await this._queue.list({ tenantId, limit: 25 }).catch(() => [])
      : [];
    const learningSnapshot = this.learningLoop.snapshotFor(tenantId);
    const persistence = RuntimePersistence.instance();
    const [persistedLearning, persistedBus, learningTimeline, envelopeTimeline] = tenantId
      ? await Promise.all([
          persistence.learningAggregate(tenantId),
          persistence.busAggregate(tenantId),
          persistence.recentLearning(tenantId, 20),
          persistence.recentEnvelopes(tenantId, 20),
        ])
      : [null, null, [], []];
    return {
      status: this.status(),
      autonomy,
      heartbeat: tick,
      counters,
      learning: {
        cycles: learningSnapshot.metrics.learningCycles,
        hypotheses: {
          created: learningSnapshot.metrics.hypothesesCreated,
          accepted: learningSnapshot.metrics.hypothesesAccepted,
          rejected: learningSnapshot.metrics.hypothesesRejected,
          consolidated: learningSnapshot.metrics.knowledgeConsolidated,
        },
        knowledgeConsolidated: learningSnapshot.metrics.knowledgeConsolidated,
        averageConfidence: learningSnapshot.metrics.averageConfidence,
        lastLearning: learningSnapshot.metrics.lastLearningAt,
        lastAgent: learningSnapshot.metrics.lastAgentId,
        ignoredExecutions: learningSnapshot.metrics.ignoredExecutions,
        perAgent: learningSnapshot.metrics.perAgent,
        store: learningSnapshot.store,
        lastCycle: learningSnapshot.lastCycle,
        chain: learningSnapshot.chain,
        tenant: learningSnapshot.tenant ?? null,
        knowledgeEvolution: {
          consolidatedTenants: learningSnapshot.store.tenantsWithConsolidated,
          totalCycles: learningSnapshot.store.totalCycles,
          averageConfidence: learningSnapshot.metrics.averageConfidence,
        },
      },
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
      intelligence: {
        allowlist: Array.from(this.executionEngine.allowlist),
        connectedAgents: Array.from(this.executionEngine.allowlist).map((id) => ({
          agentId: id,
          adapterHealth: this.adapters.get(id)?.health() ?? null,
          lastExecution: this.executionEngine.lastRealExecution(id),
        })),
      },
      knowledgeBus: (() => {
        const base = this.context.snapshot();
        const nowMs = RuntimeClock.now();

        // System-health mantém seu próprio publisher (Etapa 9).
        const shAdapter = this.adapters.get("system-health") as unknown as
          | { publisherSnapshot?: () => {
              connected: boolean;
              publishCount: number;
              publishErrors: number;
              lastPublishedAtMs: number | null;
              lastError: string | null;
              lastEnvelopeId: string | null;
              lastExpiresAt: string | null;
              lastTenantId: string | null;
            } }
          | null;
        const shProducer = shAdapter?.publisherSnapshot?.() ?? null;
        const shLatest =
          tenantId && shProducer
            ? this.context.bus.latest(tenantId, "system-health", "system-health")
            : null;

        // Adapters ProducerConsumer da Etapa 11.
        interface PCA {
          agentId: string;
          consumerTelemetry?: () => {
            totalReads: number; hits: number; misses: number; partialHits: number;
            fallbacks: number; lastReadAt: string | null; lastError: string | null;
            hitRate: number; topics: string[];
          };
          producerTelemetry?: () => {
            connected: boolean; publishCount: number; publishErrors: number;
            lastPublishedAt: string | null; lastError: string | null;
            lastEnvelopeId: string | null; lastExpiresAt: string | null;
            lastTopic: string | null; lastTenantId: string | null;
          };
        }
        const pcaIds = [
          "business-brain",
          "business-learning",
          "scientific-knowledge",
          "scientific-memory",
          "professor",
          "executive-intelligence",
          "executive-knowledge",
          "executive-narrative",
        ] as const;

        type JV = string | number | boolean | null | string[];
        const producers: Record<string, Record<string, JV>> = {};
        const consumers: Record<string, Record<string, JV>> = {};

        for (const id of pcaIds) {
          const a = this.adapters.get(id) as unknown as PCA | null;
          const prod = a?.producerTelemetry?.();
          const cons = a?.consumerTelemetry?.();
          if (prod) {
            producers[id] = {
              agentId: id,
              topic: prod.lastTopic,
              connected: prod.connected,
              publishCount: prod.publishCount,
              publishErrors: prod.publishErrors,
              lastPublishedAt: prod.lastPublishedAt,
              lastError: prod.lastError,
              currentEnvelopeAvailable: Boolean(prod.lastEnvelopeId),
              expiresAt: prod.lastExpiresAt,
            };
          }
          if (cons) {
            consumers[id] = {
              agentId: id,
              totalReads: cons.totalReads,
              hits: cons.hits,
              misses: cons.misses,
              partialHits: cons.partialHits,
              fallbacks: cons.fallbacks,
              hitRate: cons.hitRate,
              lastRead: cons.lastReadAt,
              lastError: cons.lastError,
              topics: cons.topics,
            };
          }
        }

        // system-health producer preservado (Etapa 9)
        producers["system-health"] = {
          agentId: "system-health",
          topic: "system-health",
          connected: shProducer?.connected ?? false,
          publishCount: shProducer?.publishCount ?? 0,
          publishErrors: shProducer?.publishErrors ?? 0,
          lastError: shProducer?.lastError ?? null,
          lastPublishedAt: shProducer?.lastPublishedAtMs
            ? new Date(shProducer.lastPublishedAtMs).toISOString()
            : null,
          currentEnvelopeAvailable: Boolean(shLatest),
          envelopeAgeSeconds: shLatest
            ? Math.max(0, Math.floor((nowMs - new Date(shLatest.createdAt).getTime()) / 1000))
            : null,
          expiresAt: shLatest?.expiresAt ?? shProducer?.lastExpiresAt ?? null,
          currentEnvelopeId: shLatest?.id ?? null,
        };

        return {
          ...base,
          producers,
          consumers,
          // Backward-compat (Etapa 9/10)
          systemHealthProducer: producers["system-health"],
        };
      })(),
    };
  }

  static __resetForTests(): void {
    AutonomousRuntime._instance?.heartbeat.stop();
    AutonomousRuntime._instance = null;
  }
}
