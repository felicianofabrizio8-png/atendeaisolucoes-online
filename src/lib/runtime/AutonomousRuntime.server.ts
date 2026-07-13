// ============================================================================
// AutonomousRuntime — Ponto central do sistema nervoso.
// Etapa 1 (Fundação): inicializa, registra agentes, mantém heartbeat e
// expõe status. NÃO executa agentes. NÃO altera comportamento operacional.
// Stateless multi-tenant: nunca armazena contexto de empresa.
// ============================================================================

import { AgentDispatcher } from "./AgentDispatcher.server";
import { AgentOrchestrator } from "./AgentOrchestrator.server";
import { AgentRegistry } from "./AgentRegistry.server";
import { RuntimeClock } from "./RuntimeClock.server";
import { RuntimeHeartbeat } from "./RuntimeHeartbeat.server";
import { RUNTIME_VERSION, type RuntimeStatus } from "./RuntimeTypes";

export class AutonomousRuntime {
  readonly registry: AgentRegistry;
  readonly dispatcher: AgentDispatcher;
  readonly orchestrator: AgentOrchestrator;
  readonly heartbeat: RuntimeHeartbeat;
  readonly startedAtMs: number;
  readonly startedAtIso: string;

  private static _instance: AutonomousRuntime | null = null;

  private constructor() {
    this.startedAtMs = RuntimeClock.now();
    this.startedAtIso = new Date(this.startedAtMs).toISOString();
    this.registry = new AgentRegistry();
    this.dispatcher = new AgentDispatcher(this.registry);
    this.orchestrator = new AgentOrchestrator(this.registry);
    this.heartbeat = new RuntimeHeartbeat(this.registry, this.startedAtMs);
    // Primeiro tick sincrônico (sem iniciar loop automático).
    this.heartbeat.tick();
  }

  /** Singleton lazy. Sem side-effects globais até a primeira chamada. */
  static instance(): AutonomousRuntime {
    if (!AutonomousRuntime._instance) {
      AutonomousRuntime._instance = new AutonomousRuntime();
    }
    return AutonomousRuntime._instance;
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

  /** Snapshot completo para observabilidade (Neural Panel futuro). */
  snapshot() {
    return {
      status: this.status(),
      agents: this.registry.list().map((a) => ({
        id: a.descriptor.id,
        name: a.descriptor.name,
        category: a.descriptor.category,
        enabled: a.descriptor.enabled,
        executionMode: a.descriptor.executionMode,
        priority: a.descriptor.priority,
        dependencies: a.descriptor.dependencies,
        state: a.state,
      })),
    };
  }

  /** EXCLUSIVO para testes. */
  static __resetForTests(): void {
    AutonomousRuntime._instance?.heartbeat.stop();
    AutonomousRuntime._instance = null;
  }
}
