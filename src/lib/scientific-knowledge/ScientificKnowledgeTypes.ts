// ============================================================================
// Scientific Knowledge Engine — Types (Fase 3)
// 100% READ-ONLY. Determinístico. Sem LLM. Sem PII. Sem IDs externos.
// Consome APENAS Business Brain Snapshot + Business Learning Snapshot +
// Executive Knowledge Timeline. Não acessa CRM, mensagens, leads, etc.
// ============================================================================

export const SCIENTIFIC_VERSION = "science-v1.0.0" as const;

export type SciencePeriod = "7d" | "30d" | "90d";

// -------- Observations ------------------------------------------------------
export type ObservationCategory =
  | "objection"
  | "buying_signal"
  | "product"
  | "channel"
  | "timing"
  | "conversion"
  | "abandonment"
  | "followup"
  | "operational"
  | "quality";

export type ObservationSource =
  | "business_brain:pattern"
  | "business_brain:knowledge"
  | "business_brain:trend"
  | "business_learning:evolution"
  | "business_learning:hypothesis"
  | "business_learning:learning"
  | "executive_knowledge:timeline";

export interface ScientificObservation {
  id: string;
  category: ObservationCategory;
  title: string;
  description: string;
  observedAt: string; // ISO
  occurrences: number;
  confidence: number; // 0..1
  source: ObservationSource;
  period: SciencePeriod;
}

// -------- Hypotheses --------------------------------------------------------
export type HypothesisStatus =
  | "observed"
  | "strengthening"
  | "validated"
  | "weakening"
  | "discarded";

export interface ScientificHypothesis {
  id: string;
  category: ObservationCategory;
  title: string;
  description: string;
  confidence: number; // 0..1
  occurrences: number;
  firstObserved: string | null;
  lastObserved: string | null;
  supportingEvidence: string[]; // evidence ids
  status: HypothesisStatus;
}

// -------- Evidence ----------------------------------------------------------
export interface ScientificEvidence {
  id: string;
  hypothesisId: string;
  metrics: string[]; // metric names, aggregate only
  patterns: string[]; // Business Brain pattern ids
  knowledge: string[]; // Business Brain knowledge ids
  learning: string[]; // Business Learning learning ids
  sampleSize: number;
  confidence: number; // 0..1
}

// -------- Scientific Knowledge ---------------------------------------------
export type ScientificKnowledgeStatus =
  | "candidate"
  | "validated"
  | "historical"
  | "deprecated";

export interface ScientificKnowledge {
  id: string;
  category: ObservationCategory;
  title: string;
  summary: string;
  confidence: number; // 0..1
  validatedSince: string | null; // ISO
  supportingHypotheses: string[]; // hypothesis ids
  supportingEvidence: string[]; // evidence ids
  status: ScientificKnowledgeStatus;
}

// -------- Snapshot ----------------------------------------------------------
export interface ScientificKnowledgeSnapshot {
  generatedAt: string;
  scientificVersion: string;
  period: SciencePeriod;
  sample: {
    observations: number;
    hypotheses: number;
    evidence: number;
    validatedKnowledge: number;
    brainPatterns: number;
    brainKnowledge: number;
    brainTrends: number;
    learningHypotheses: number;
    learningEvolutions: number;
    knowledgeTimeline: number;
  };
  observations: ScientificObservation[];
  hypotheses: ScientificHypothesis[];
  evidence: ScientificEvidence[];
  validatedKnowledge: ScientificKnowledge[];
}

// -------- Validation thresholds (deterministic, no heuristics) --------------
export const SCIENCE_THRESHOLDS = {
  MIN_OCCURRENCES_FOR_STRENGTHENING: 3,
  MIN_OCCURRENCES_FOR_VALIDATED: 5,
  MIN_HISTORY_SNAPSHOTS_FOR_VALIDATED: 3,
  MIN_CONFIDENCE_FOR_VALIDATED: 0.6,
  DISCARD_CONFIDENCE_BELOW: 0.1,
  WEAKENING_CONFIDENCE_BELOW: 0.3,
} as const;
