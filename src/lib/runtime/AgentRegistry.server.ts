// ============================================================================
// AgentRegistry — Catálogo de todos os agentes do sistema.
// Etapa 2: metadata estendida (concurrency/retry/timeout/priorities).
// NÃO importa nenhum handler. NÃO executa nada.
// ============================================================================

import { AgentExecutionPolicy } from "./AgentExecutionPolicy.server";
import { RuntimeClock } from "./RuntimeClock.server";
import type {
  AgentDescriptor,
  AgentExecutionMode,
  AgentRetryPolicy,
  AgentRuntimeState,
  AgentTimeoutPolicy,
  RegisteredAgent,
  RuntimeJobPriority,
} from "./RuntimeTypes";

const INITIAL_STATE: AgentRuntimeState = {
  status: "idle",
  health: "unknown",
  lastExecution: null,
  lastSuccess: null,
  lastFailure: null,
  lastError: null,
};

const DEFAULT_MODES: AgentExecutionMode[] = ["manual", "queue"];
const DEFAULT_PRIORITIES: RuntimeJobPriority[] = ["critical", "high", "normal", "low", "background"];

function retry(overrides: Partial<AgentRetryPolicy> = {}): AgentRetryPolicy {
  return { maxAttempts: 3, backoffSeconds: 30, jitter: true, ...overrides };
}
function timeout(overrides: Partial<AgentTimeoutPolicy> = {}): AgentTimeoutPolicy {
  return { softTimeoutMs: 45_000, hardTimeoutMs: 90_000, ...overrides };
}

/** Descritores estáticos (metadata). Comportamento dos agentes NÃO muda. */
const AGENT_DESCRIPTORS: AgentDescriptor[] = [
  {
    id: "conversation-intelligence",
    name: "Conversation Intelligence",
    version: "1.0.0",
    category: "conversation",
    enabled: true,
    executionMode: "queue",
    supportedExecutionModes: ["queue", "event", "manual"],
    supportedPriorities: DEFAULT_PRIORITIES,
    maxConcurrency: 4,
    retryPolicy: retry({ maxAttempts: 5, backoffSeconds: 60 }),
    timeoutPolicy: timeout({ softTimeoutMs: 60_000, hardTimeoutMs: 120_000 }),
    dependencies: [],
    priority: { level: 2, weight: 90 },
    policy: AgentExecutionPolicy.create({ concurrency: 2, timeoutMs: 120_000 }),
  },
  {
    id: "business-brain",
    name: "Business Brain",
    version: "1.0.0",
    category: "brain",
    enabled: true,
    executionMode: "manual",
    supportedExecutionModes: ["manual", "scheduled", "queue"],
    supportedPriorities: DEFAULT_PRIORITIES,
    maxConcurrency: 1,
    retryPolicy: retry(),
    timeoutPolicy: timeout(),
    dependencies: ["conversation-intelligence"],
    priority: { level: 3, weight: 70 },
    policy: AgentExecutionPolicy.create({ timeoutMs: 90_000 }),
  },
  {
    id: "business-learning",
    name: "Business Learning",
    version: "1.0.0",
    category: "learning",
    enabled: true,
    executionMode: "manual",
    supportedExecutionModes: ["manual", "scheduled", "queue"],
    supportedPriorities: DEFAULT_PRIORITIES,
    maxConcurrency: 1,
    retryPolicy: retry(),
    timeoutPolicy: timeout(),
    dependencies: ["business-brain"],
    priority: { level: 3, weight: 65 },
    policy: AgentExecutionPolicy.create({ timeoutMs: 90_000 }),
  },
  {
    id: "scientific-knowledge",
    name: "Scientific Knowledge",
    version: "1.0.0",
    category: "scientific",
    enabled: true,
    executionMode: "manual",
    supportedExecutionModes: ["manual", "scheduled", "queue"],
    supportedPriorities: DEFAULT_PRIORITIES,
    maxConcurrency: 1,
    retryPolicy: retry({ maxAttempts: 2 }),
    timeoutPolicy: timeout({ softTimeoutMs: 90_000, hardTimeoutMs: 180_000 }),
    dependencies: ["business-brain", "business-learning"],
    priority: { level: 4, weight: 60 },
    policy: AgentExecutionPolicy.create({ timeoutMs: 120_000 }),
  },
  {
    id: "scientific-memory",
    name: "Scientific Memory",
    version: "1.0.0",
    category: "scientific",
    enabled: true,
    executionMode: "manual",
    supportedExecutionModes: ["manual", "scheduled", "queue"],
    supportedPriorities: DEFAULT_PRIORITIES,
    maxConcurrency: 1,
    retryPolicy: retry({ maxAttempts: 2 }),
    timeoutPolicy: timeout({ softTimeoutMs: 90_000, hardTimeoutMs: 180_000 }),
    dependencies: ["scientific-knowledge"],
    priority: { level: 5, weight: 55 },
    policy: AgentExecutionPolicy.create({ timeoutMs: 120_000 }),
  },
  {
    id: "professor",
    name: "Professor AI",
    version: "1.0.0",
    category: "professor",
    enabled: true,
    executionMode: "manual",
    supportedExecutionModes: ["manual", "queue"],
    supportedPriorities: DEFAULT_PRIORITIES,
    maxConcurrency: 1,
    retryPolicy: retry(),
    timeoutPolicy: timeout(),
    dependencies: ["scientific-memory"],
    priority: { level: 5, weight: 50 },
    policy: AgentExecutionPolicy.create({ timeoutMs: 90_000 }),
  },
  {
    id: "executive-intelligence",
    name: "Executive Intelligence",
    version: "1.0.0",
    category: "executive",
    enabled: true,
    executionMode: "manual",
    supportedExecutionModes: ["manual", "scheduled", "queue"],
    supportedPriorities: DEFAULT_PRIORITIES,
    maxConcurrency: 1,
    retryPolicy: retry(),
    timeoutPolicy: timeout(),
    dependencies: [],
    priority: { level: 3, weight: 75 },
    policy: AgentExecutionPolicy.create({ timeoutMs: 90_000 }),
  },
  {
    id: "executive-knowledge",
    name: "Executive Knowledge",
    version: "1.0.0",
    category: "executive",
    enabled: true,
    executionMode: "manual",
    supportedExecutionModes: ["manual", "scheduled", "queue"],
    supportedPriorities: DEFAULT_PRIORITIES,
    maxConcurrency: 1,
    retryPolicy: retry(),
    timeoutPolicy: timeout(),
    dependencies: ["executive-intelligence"],
    priority: { level: 4, weight: 65 },
    policy: AgentExecutionPolicy.create({ timeoutMs: 90_000 }),
  },
  {
    id: "executive-narrative",
    name: "Executive Narrative",
    version: "1.0.0",
    category: "executive",
    enabled: true,
    executionMode: "manual",
    supportedExecutionModes: ["manual", "queue"],
    supportedPriorities: DEFAULT_PRIORITIES,
    maxConcurrency: 1,
    retryPolicy: retry(),
    timeoutPolicy: timeout(),
    dependencies: ["executive-knowledge"],
    priority: { level: 5, weight: 55 },
    policy: AgentExecutionPolicy.create({ timeoutMs: 90_000 }),
  },
  {
    id: "sales-intelligence",
    name: "Sales Intelligence",
    version: "1.0.0",
    category: "sales",
    enabled: true,
    executionMode: "manual",
    supportedExecutionModes: ["manual", "scheduled", "queue"],
    supportedPriorities: DEFAULT_PRIORITIES,
    maxConcurrency: 1,
    retryPolicy: retry(),
    timeoutPolicy: timeout(),
    dependencies: [],
    priority: { level: 3, weight: 70 },
    policy: AgentExecutionPolicy.create({ timeoutMs: 90_000 }),
  },
  {
    id: "coach",
    name: "Coach",
    version: "1.0.0",
    category: "coach",
    enabled: true,
    executionMode: "event",
    supportedExecutionModes: ["event", "queue", "manual"],
    supportedPriorities: DEFAULT_PRIORITIES,
    maxConcurrency: 2,
    retryPolicy: retry({ maxAttempts: 3, backoffSeconds: 20 }),
    timeoutPolicy: timeout({ softTimeoutMs: 30_000, hardTimeoutMs: 60_000 }),
    dependencies: [],
    priority: { level: 2, weight: 80 },
    policy: AgentExecutionPolicy.create({ timeoutMs: 60_000 }),
  },
  {
    id: "followup",
    name: "Follow-up",
    version: "2.0.0",
    category: "followup",
    enabled: true,
    executionMode: "event",
    supportedExecutionModes: ["event", "scheduled", "queue"],
    supportedPriorities: DEFAULT_PRIORITIES,
    maxConcurrency: 4,
    retryPolicy: retry({ maxAttempts: 5 }),
    timeoutPolicy: timeout({ softTimeoutMs: 30_000, hardTimeoutMs: 60_000 }),
    dependencies: [],
    priority: { level: 2, weight: 85 },
    policy: AgentExecutionPolicy.create({ timeoutMs: 60_000 }),
  },
  {
    id: "billing",
    name: "Billing Metrics",
    version: "1.0.0",
    category: "billing",
    enabled: true,
    executionMode: "event",
    supportedExecutionModes: ["event", "queue"],
    supportedPriorities: DEFAULT_PRIORITIES,
    maxConcurrency: 8,
    retryPolicy: retry({ maxAttempts: 5, backoffSeconds: 10 }),
    timeoutPolicy: timeout({ softTimeoutMs: 15_000, hardTimeoutMs: 30_000 }),
    dependencies: [],
    priority: { level: 6, weight: 40 },
    policy: AgentExecutionPolicy.create({ timeoutMs: 30_000 }),
  },
  {
    id: "system-health",
    name: "System Health",
    version: "1.0.0",
    category: "health",
    enabled: true,
    executionMode: "event",
    supportedExecutionModes: ["event", "scheduled", "queue"],
    supportedPriorities: DEFAULT_PRIORITIES,
    maxConcurrency: 4,
    retryPolicy: retry({ maxAttempts: 2 }),
    timeoutPolicy: timeout({ softTimeoutMs: 15_000, hardTimeoutMs: 30_000 }),
    dependencies: [],
    priority: { level: 6, weight: 40 },
    policy: AgentExecutionPolicy.create({ timeoutMs: 30_000 }),
  },
  {
    id: "llm-gateway",
    name: "LLM Gateway",
    version: "1.0.0",
    category: "llm",
    enabled: true,
    executionMode: "event",
    supportedExecutionModes: DEFAULT_MODES,
    supportedPriorities: DEFAULT_PRIORITIES,
    maxConcurrency: 16,
    retryPolicy: retry({ maxAttempts: 3, backoffSeconds: 5 }),
    timeoutPolicy: timeout({ softTimeoutMs: 30_000, hardTimeoutMs: 60_000 }),
    dependencies: [],
    priority: { level: 1, weight: 100 },
    policy: AgentExecutionPolicy.create({ concurrency: 8, timeoutMs: 60_000 }),
  },
];

export class AgentRegistry {
  private readonly agents = new Map<string, RegisteredAgent>();

  constructor(descriptors: AgentDescriptor[] = AGENT_DESCRIPTORS) {
    for (const d of descriptors) this.register(d);
  }

  register(descriptor: AgentDescriptor): void {
    if (this.agents.has(descriptor.id)) {
      throw new Error(`[AgentRegistry] agent já registrado: ${descriptor.id}`);
    }
    this.agents.set(descriptor.id, {
      descriptor,
      state: { ...INITIAL_STATE },
    });
  }

  get(id: string): RegisteredAgent | null {
    return this.agents.get(id) ?? null;
  }

  list(): RegisteredAgent[] {
    return Array.from(this.agents.values());
  }

  size(): number {
    return this.agents.size;
  }

  healthyCount(): number {
    return this.list().filter((a) => a.descriptor.enabled && a.state.health === "healthy").length;
  }

  disabledCount(): number {
    return this.list().filter((a) => !a.descriptor.enabled).length;
  }

  /** Etapa 2: nunca chamado por scheduler. Reservado para etapas futuras. */
  markExecution(id: string, outcome: "success" | "failure", error?: string): void {
    const a = this.agents.get(id);
    if (!a) return;
    const ts = RuntimeClock.nowIso();
    a.state.lastExecution = ts;
    if (outcome === "success") {
      a.state.lastSuccess = ts;
      a.state.status = "success";
      a.state.health = "healthy";
      a.state.lastError = null;
    } else {
      a.state.lastFailure = ts;
      a.state.status = "failure";
      a.state.health = "degraded";
      a.state.lastError = error ?? "unknown";
    }
  }
}

export const DEFAULT_AGENT_DESCRIPTORS = AGENT_DESCRIPTORS;
