// ============================================================================
// KnowledgeContextTypes — Contratos do Shared Intelligence Context.
// Etapa 8: apenas tipos. Nenhum comportamento.
// ============================================================================

export type KnowledgePriority = "critical" | "high" | "normal" | "low" | "background";
export type KnowledgeHealthLevel = "healthy" | "degraded" | "unknown" | "down";

/** Todos os topics permitidos no Knowledge Bus. */
export type KnowledgeTopicId =
  | "business-patterns"
  | "business-learning"
  | "scientific-observations"
  | "scientific-theories"
  | "scientific-memory"
  | "executive-summary"
  | "executive-knowledge"
  | "executive-narrative"
  | "professor-insights"
  | "sales-insights"
  | "coach-insights"
  | "system-health"
  | "billing";

export interface KnowledgeEnvelope {
  id: string;
  topic: KnowledgeTopicId;
  agentId: string;
  tenantId: string;
  version: number;
  createdAt: string;
  expiresAt: string | null;
  priority: KnowledgePriority;
  confidence: number; // 0..1
  scientificScore: number; // 0..1
  knowledgeScore: number; // 0..1
  payloadHash: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

export interface KnowledgeCacheSnapshot {
  totalEnvelopes: number;
  perTopic: Array<{ topic: KnowledgeTopicId; count: number; tenants: number }>;
  perTenant: Array<{ tenantId: string; count: number; topics: number }>;
  evictions: number;
  expired: number;
  memoryOnly: true;
}

export interface KnowledgeTopicDescriptor {
  id: KnowledgeTopicId;
  ownerAgentId: string;
  description: string;
  defaultTtlMs: number;
  defaultPriority: KnowledgePriority;
}

export interface SubscriberEntry {
  id: string;
  topic: KnowledgeTopicId;
  tenantId: string;
  agentId: string | null;
  createdAt: string;
}

export interface KnowledgeBusHealth {
  level: KnowledgeHealthLevel;
  lastActivityAt: string | null;
  publishCount: number;
  readCount: number;
  errors: number;
}

export const KNOWLEDGE_ENVELOPE_MAX_METADATA_KEYS = 24;
export const KNOWLEDGE_DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6h
export const KNOWLEDGE_MAX_PER_TENANT = 512;
export const KNOWLEDGE_MAX_TOTAL = 8192;
