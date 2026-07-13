// ============================================================================
// KnowledgeTopics — Catálogo estático de topics do Knowledge Bus.
// Nenhum topic dispara automação. Apenas metadata.
// ============================================================================

import {
  KNOWLEDGE_DEFAULT_TTL_MS,
  type KnowledgeTopicDescriptor,
  type KnowledgeTopicId,
} from "./KnowledgeContextTypes";

const TOPICS: KnowledgeTopicDescriptor[] = [
  { id: "business-patterns", ownerAgentId: "business-brain", description: "Padrões consolidados do negócio.", defaultTtlMs: KNOWLEDGE_DEFAULT_TTL_MS, defaultPriority: "normal" },
  { id: "business-learning", ownerAgentId: "business-learning", description: "Aprendizado contínuo do negócio.", defaultTtlMs: KNOWLEDGE_DEFAULT_TTL_MS, defaultPriority: "normal" },
  { id: "scientific-observations", ownerAgentId: "scientific-knowledge", description: "Observações científicas registradas.", defaultTtlMs: KNOWLEDGE_DEFAULT_TTL_MS, defaultPriority: "normal" },
  { id: "scientific-theories", ownerAgentId: "scientific-knowledge", description: "Teorias validadas cientificamente.", defaultTtlMs: KNOWLEDGE_DEFAULT_TTL_MS, defaultPriority: "high" },
  { id: "scientific-memory", ownerAgentId: "scientific-memory", description: "Snapshot da memória científica permanente.", defaultTtlMs: KNOWLEDGE_DEFAULT_TTL_MS, defaultPriority: "high" },
  { id: "executive-summary", ownerAgentId: "executive-intelligence", description: "Resumo executivo consolidado.", defaultTtlMs: KNOWLEDGE_DEFAULT_TTL_MS, defaultPriority: "high" },
  { id: "executive-knowledge", ownerAgentId: "executive-knowledge", description: "Conhecimento executivo comparado.", defaultTtlMs: KNOWLEDGE_DEFAULT_TTL_MS, defaultPriority: "normal" },
  { id: "executive-narrative", ownerAgentId: "executive-narrative", description: "Narrativa executiva estruturada.", defaultTtlMs: KNOWLEDGE_DEFAULT_TTL_MS, defaultPriority: "normal" },
  { id: "professor-insights", ownerAgentId: "professor", description: "Insights consolidados do Professor.", defaultTtlMs: KNOWLEDGE_DEFAULT_TTL_MS, defaultPriority: "normal" },
  { id: "sales-insights", ownerAgentId: "sales-intelligence", description: "Insights consolidados de vendas.", defaultTtlMs: KNOWLEDGE_DEFAULT_TTL_MS, defaultPriority: "normal" },
  { id: "coach-insights", ownerAgentId: "coach", description: "Insights consolidados do coach.", defaultTtlMs: KNOWLEDGE_DEFAULT_TTL_MS, defaultPriority: "normal" },
  { id: "system-health", ownerAgentId: "system-health", description: "Sinal consolidado de saúde do sistema.", defaultTtlMs: 5 * 60 * 1000, defaultPriority: "critical" },
  { id: "billing", ownerAgentId: "billing", description: "Métricas consolidadas de billing.", defaultTtlMs: KNOWLEDGE_DEFAULT_TTL_MS, defaultPriority: "background" },
];

export class KnowledgeTopics {
  private readonly byId = new Map<KnowledgeTopicId, KnowledgeTopicDescriptor>();
  constructor(descriptors: KnowledgeTopicDescriptor[] = TOPICS) {
    for (const d of descriptors) this.byId.set(d.id, d);
  }
  list(): KnowledgeTopicDescriptor[] {
    return Array.from(this.byId.values());
  }
  get(id: KnowledgeTopicId): KnowledgeTopicDescriptor | null {
    return this.byId.get(id) ?? null;
  }
  has(id: string): id is KnowledgeTopicId {
    return this.byId.has(id as KnowledgeTopicId);
  }
  size(): number {
    return this.byId.size;
  }
}

export const KNOWLEDGE_TOPIC_DESCRIPTORS = TOPICS;
