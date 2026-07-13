// ============================================================================
// Business Intelligence Brain — Types (Fase 1)
// 100% READ-ONLY. Nunca contém PII, IDs externos, texto de mensagens ou
// referências a clientes/conversas específicas. Somente agregados.
// ============================================================================

export const BRAIN_VERSION = "brain-v1.0.0" as const;

export type BrainPeriod = "7d" | "30d" | "90d";

// -------- Métricas agregadas --------------------------------------------------
export interface FrequencyItem {
  key: string;
  count: number;
  percentage: number; // 0..100
}

export interface ChannelBreakdown {
  channel: string;
  conversations: number;
  sold: number;
  lost: number;
  abandoned: number;
  inProgress: number;
  avgConfidence: number;
}

export interface TimingMetrics {
  avgFirstResponseMinutes: number | null;
  avgNegotiationMinutesToSale: number | null;
  avgNegotiationMinutesToLoss: number | null;
  avgNegotiationMinutesToAbandon: number | null;
}

export interface EvolutionBucket {
  bucket: string; // YYYY-MM-DD (day) or YYYY-Www (week) or YYYY-MM (month)
  conversations: number;
  sold: number;
  lost: number;
}

export interface EvolutionSeries {
  weekly: EvolutionBucket[];
  monthly: EvolutionBucket[];
}

export interface BrainMetrics {
  totalConversationsAnalyzed: number;
  byLifecycle: Record<string, number>;
  byChannel: ChannelBreakdown[];
  topObjections: FrequencyItem[];
  topBuyingSignals: FrequencyItem[];
  topNegativeSignals: FrequencyItem[];
  topProducts: FrequencyItem[];
  topIntents: FrequencyItem[];
  topTopics: FrequencyItem[];
  sentimentDistribution: Record<string, number>;
  timing: TimingMetrics;
  evolution: EvolutionSeries;
}

// -------- Patterns ------------------------------------------------------------
export type PatternCategory =
  | "objection"
  | "buying_signal"
  | "product"
  | "channel"
  | "timing"
  | "campaign"
  | "abandonment"
  | "conversion"
  | "followup"
  | "seasonal"
  | "custom";

export type Trend = "rising" | "stable" | "falling";

/** Evidence só transporta dados agregados. Nunca strings vindas de mensagens. */
export interface PatternEvidence {
  conversations?: number;
  percentage?: number;
  avgMinutes?: number;
  avgTicket?: number;
  channel?: string;
  reference?: string; // rótulo determinístico ex: "sample=90d"
}

export interface BusinessPattern {
  id: string;
  category: PatternCategory;
  description: string;
  occurrences: number;
  confidence: number; // 0..1
  firstObserved: string | null; // ISO
  lastObserved: string | null; // ISO
  trend: Trend;
  evidence: PatternEvidence;
}

// -------- Knowledge -----------------------------------------------------------
export type KnowledgeCategory =
  | "operational"
  | "commercial"
  | "product"
  | "channel"
  | "timing"
  | "quality";

export interface KnowledgeEvidence {
  metrics: string[]; // nomes de métricas, ex: "avg_first_response_minutes"
  sample: number; // nº de conversas / snapshots que sustentam a afirmação
}

export interface BusinessKnowledge {
  id: string;
  category: KnowledgeCategory;
  title: string;
  summary: string;
  confidence: number; // 0..1
  evidence: KnowledgeEvidence;
  createdAt: string; // ISO
}

// -------- Trends --------------------------------------------------------------
export type TrendDirection = "up" | "down" | "flat";

export interface BusinessTrend {
  id: string;
  metric: string;
  direction: TrendDirection;
  delta: number; // valor absoluto (positivo ou negativo)
  percentDelta: number | null;
  period: BrainPeriod;
  confidence: number; // 0..1
}

// -------- Snapshot final ------------------------------------------------------
export interface BusinessBrainSnapshot {
  generatedAt: string;
  brainVersion: string;
  period: BrainPeriod;
  sample: {
    conversationFacts: number;
    knowledgeSnapshots: number;
    hasExecutiveSnapshot: boolean;
  };
  metrics: BrainMetrics;
  patterns: BusinessPattern[];
  knowledge: BusinessKnowledge[];
  trends: BusinessTrend[];
}
