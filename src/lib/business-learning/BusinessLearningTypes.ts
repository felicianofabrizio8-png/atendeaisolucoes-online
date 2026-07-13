// ============================================================================
// Business Learning Engine — Types (Fase 2)
// 100% READ-ONLY. Sem PII, sem texto de mensagens, sem IDs externos.
// Observa a evolução do conhecimento produzido pelo Business Brain e pelo
// Executive Knowledge.
// ============================================================================

export const LEARNING_VERSION = "learn-v1.0.0" as const;

export type LearningPeriod = "7d" | "30d" | "90d";

// -------- Evolution ----------------------------------------------------------
export type EvolutionDirection =
  | "rising"
  | "falling"
  | "stable"
  | "emerging"
  | "disappearing";

export interface BusinessEvolution {
  id: string;
  metric: string;
  previousValue: number;
  currentValue: number;
  delta: number;
  deltaPercent: number | null;
  direction: EvolutionDirection;
  confidence: number; // 0..1
  periodCompared: string; // rótulo determinístico, ex: "week:2026-W27→2026-W28"
  observedAt: string; // ISO
}

// -------- Hypothesis ---------------------------------------------------------
export type HypothesisCategory =
  | "objection"
  | "buying_signal"
  | "product"
  | "channel"
  | "timing"
  | "conversion"
  | "abandonment"
  | "followup"
  | "operational";

export type HypothesisStatus =
  | "observed"
  | "strengthening"
  | "validated"
  | "weakening"
  | "discarded";

/** Evidence só transporta números agregados. Nunca strings de mensagem. */
export interface HypothesisEvidence {
  metrics: string[];
  sample: number;
  correlation?: number; // -1..1 quando aplicável
  note?: string; // rótulo determinístico
}

export interface BusinessHypothesis {
  id: string;
  category: HypothesisCategory;
  title: string;
  description: string;
  confidence: number; // 0..1
  occurrences: number;
  firstObserved: string | null;
  lastObserved: string | null;
  status: HypothesisStatus;
  evidence: HypothesisEvidence;
}

// -------- Learning -----------------------------------------------------------
export type LearningCategory =
  | "commercial"
  | "operational"
  | "product"
  | "channel"
  | "timing"
  | "quality";

export interface BusinessLearning {
  id: string;
  category: LearningCategory;
  title: string;
  summary: string;
  confidence: number; // 0..1
  supportingPatterns: string[]; // ids de patterns do Business Brain
  supportingKnowledge: string[]; // ids de knowledge do Business Brain
  createdAt: string;
}

// -------- Snapshot -----------------------------------------------------------
export interface BusinessLearningSnapshot {
  generatedAt: string;
  learningVersion: string;
  period: LearningPeriod;
  sample: {
    brainPatterns: number;
    brainKnowledge: number;
    brainTrends: number;
    executiveKnowledgeSnapshots: number;
    weeklyBuckets: number;
    monthlyBuckets: number;
  };
  evolution: BusinessEvolution[];
  hypotheses: BusinessHypothesis[];
  learning: BusinessLearning[];
}
