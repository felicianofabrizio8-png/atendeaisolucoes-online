// ============================================================================
// SchedulerRegistry — Catálogo de agendas do Runtime.
// Todas registradas como DISABLED por padrão nesta etapa.
// Nada é executado. Nenhum job é criado aqui.
// ============================================================================

import { SchedulerPolicy, type SchedulerPolicySpec } from "./SchedulerPolicy.server";

export interface ScheduleDescriptor {
  id: string;
  agentId: string;
  name: string;
  description: string;
  enabled: boolean;
  policy: SchedulerPolicySpec;
  /** Se true, cada tenant terá sua própria agenda independente. */
  perTenant: boolean;
}

export interface ScheduleState {
  lastEvaluationAt: string | null;
  lastEnqueueAt: string | null;
  lastReason: string | null;
  nextEvaluationAt: string | null;
  duplicatesPrevented: number;
  blockedCount: number;
  enqueuedCount: number;
}

export interface RegisteredSchedule {
  descriptor: ScheduleDescriptor;
  state: ScheduleState;
}

const INITIAL_STATE: ScheduleState = {
  lastEvaluationAt: null,
  lastEnqueueAt: null,
  lastReason: null,
  nextEvaluationAt: null,
  duplicatesPrevented: 0,
  blockedCount: 0,
  enqueuedCount: 0,
};

const DESCRIPTORS: ScheduleDescriptor[] = [
  {
    id: "scientific-snapshot",
    agentId: "scientific-knowledge",
    name: "Scientific Snapshot",
    description: "Consolidação periódica do conhecimento científico do tenant.",
    enabled: false,
    perTenant: true,
    policy: SchedulerPolicy.create({ intervalSeconds: 3600, cooldownSeconds: 900, priority: "low" }),
  },
  {
    id: "scientific-memory",
    agentId: "scientific-memory",
    name: "Scientific Memory",
    description: "Refresh da memória de longo prazo do tenant.",
    enabled: false,
    perTenant: true,
    policy: SchedulerPolicy.create({ intervalSeconds: 7200, cooldownSeconds: 1800, priority: "low" }),
  },
  {
    id: "business-brain-refresh",
    agentId: "business-brain",
    name: "Business Brain Refresh",
    description: "Atualização do Business Brain com sinais recentes.",
    enabled: false,
    perTenant: true,
    policy: SchedulerPolicy.create({ intervalSeconds: 1800, cooldownSeconds: 600, priority: "normal" }),
  },
  {
    id: "business-learning-refresh",
    agentId: "business-learning",
    name: "Business Learning Refresh",
    description: "Consolidação de aprendizado incremental do tenant.",
    enabled: false,
    perTenant: true,
    policy: SchedulerPolicy.create({ intervalSeconds: 3600, cooldownSeconds: 900, priority: "low" }),
  },
  {
    id: "executive-snapshot",
    agentId: "executive-intelligence",
    name: "Executive Snapshot",
    description: "Geração periódica de snapshots executivos.",
    enabled: false,
    perTenant: true,
    policy: SchedulerPolicy.create({ intervalSeconds: 1800, cooldownSeconds: 600, priority: "normal" }),
  },
  {
    id: "coach-tick",
    agentId: "coach",
    name: "Coach Tick",
    description: "Varredura periódica do Coach por sinais de atenção.",
    enabled: false,
    perTenant: true,
    policy: SchedulerPolicy.create({ intervalSeconds: 600, cooldownSeconds: 120, priority: "high" }),
  },
  {
    id: "followup-tick",
    agentId: "followup",
    name: "Follow-up Tick",
    description: "Avaliação de follow-ups pendentes por tenant.",
    enabled: false,
    perTenant: true,
    policy: SchedulerPolicy.create({ intervalSeconds: 300, cooldownSeconds: 60, priority: "high" }),
  },
  {
    id: "health-collector",
    agentId: "system-health",
    name: "Health Collector",
    description: "Coleta de métricas de saúde do sistema.",
    enabled: false,
    perTenant: false,
    policy: SchedulerPolicy.create({ intervalSeconds: 300, cooldownSeconds: 60, priority: "background" }),
  },
  {
    id: "billing-collector",
    agentId: "billing",
    name: "Billing Collector",
    description: "Agregação de métricas de billing por tenant.",
    enabled: false,
    perTenant: true,
    policy: SchedulerPolicy.create({ intervalSeconds: 900, cooldownSeconds: 300, priority: "background" }),
  },
  {
    id: "llm-metrics",
    agentId: "llm-gateway",
    name: "LLM Metrics",
    description: "Flush periódico de métricas do LLM Gateway.",
    enabled: false,
    perTenant: false,
    policy: SchedulerPolicy.create({ intervalSeconds: 600, cooldownSeconds: 120, priority: "background" }),
  },
];

export class SchedulerRegistry {
  private readonly schedules = new Map<string, RegisteredSchedule>();

  constructor(descriptors: ScheduleDescriptor[] = DESCRIPTORS) {
    for (const d of descriptors) {
      this.schedules.set(d.id, { descriptor: d, state: { ...INITIAL_STATE } });
    }
  }

  get(id: string): RegisteredSchedule | null {
    return this.schedules.get(id) ?? null;
  }

  list(): RegisteredSchedule[] {
    return Array.from(this.schedules.values());
  }

  size(): number {
    return this.schedules.size;
  }

  enabledCount(): number {
    return this.list().filter((s) => s.descriptor.enabled).length;
  }

  disabledCount(): number {
    return this.list().filter((s) => !s.descriptor.enabled).length;
  }
}

export const DEFAULT_SCHEDULE_DESCRIPTORS = DESCRIPTORS;
