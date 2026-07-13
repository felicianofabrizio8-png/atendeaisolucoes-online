// ============================================================================
// Scientific Knowledge Engine — Types (Fase 3.1 — Calibração Científica)
// 100% READ-ONLY. Determinístico. Sem LLM. Sem PII. Sem IDs externos no público.
// ============================================================================

export const SCIENTIFIC_VERSION = "science-v1.1.0-calibrated" as const;

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
  observedDay: string; // YYYY-MM-DD (temporal bucket)
  occurrences: number; // independent facts count, NEVER deltas
  confidence: number; // 0..1 (derived, never fixed by source)
  source: ObservationSource;
  period: SciencePeriod;
  /** Same for every layer that derives from the same root fact. */
  provenanceKey: string;
  /** Identifies multi-layer derivation of the same underlying fact. */
  sourceFingerprint: string;
}

// -------- Hypotheses --------------------------------------------------------
export type HypothesisStatus =
  | "observed"
  | "insufficient_history"
  | "strengthening"
  | "validated"
  | "weakening"
  | "discarded";

export interface ScientificHypothesis {
  id: string;
  category: ObservationCategory;
  title: string;
  description: string;
  confidence: number;
  occurrences: number;
  firstObserved: string | null;
  lastObserved: string | null;
  distinctDays: number;
  supportingEvidence: string[];
  status: HypothesisStatus;
  provenanceKey: string;
  contradictionDetected: boolean;
}

// -------- Evidence (public) — no internal ids leak --------------------------
export interface ScientificEvidence {
  id: string;
  hypothesisId: string;
  provenanceKey: string;
  sourceFingerprint: string;
  /** Aggregate metric names only. */
  metrics: string[];
  /** Layer labels only (e.g. "business_brain:pattern"). NEVER internal ids. */
  sources: ObservationSource[];
  /** Independent facts (deduped by provenance root), never interpretations. */
  sampleSize: number;
  /** Distinct calendar days across observations. */
  distinctDays: number;
  confidence: number;
}

// -------- Theory (Fase 11) --------------------------------------------------
/** Theory = hypothesis repeated across distinct days but not yet consolidated. */
export interface ScientificTheory {
  id: string;
  hypothesisId: string;
  category: ObservationCategory;
  title: string;
  distinctDays: number;
  confidence: number;
  provenanceKey: string;
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
  confidence: number;
  scientificScore: number; // 0..1 maturity score
  validatedSince: string | null;
  supportingHypotheses: string[];
  supportingEvidence: string[];
  provenanceKey: string;
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
    theories: number;
    validatedKnowledge: number;
    brainPatterns: number;
    brainKnowledge: number;
    brainTrends: number;
    learningHypotheses: number;
    learningEvolutions: number;
    knowledgeTimeline: number;
    distinctSnapshotDays: number;
    productsReady: boolean;
  };
  observations: ScientificObservation[];
  hypotheses: ScientificHypothesis[];
  evidence: ScientificEvidence[];
  theories: ScientificTheory[];
  validatedKnowledge: ScientificKnowledge[];
}

// -------- Validation thresholds --------------------------------------------
export const SCIENCE_THRESHOLDS = {
  MIN_OCCURRENCES_FOR_STRENGTHENING: 3,
  MIN_OCCURRENCES_FOR_VALIDATED: 5,
  /** Distinct calendar days required (never same-execution rows). */
  MIN_DISTINCT_DAYS_FOR_STRENGTHENING: 2,
  MIN_DISTINCT_DAYS_FOR_VALIDATED: 3,
  MIN_HISTORY_SNAPSHOT_DAYS_FOR_VALIDATED: 3,
  MIN_CONFIDENCE_FOR_VALIDATED: 0.6,
  DISCARD_CONFIDENCE_BELOW: 0.1,
  WEAKENING_CONFIDENCE_BELOW: 0.3,
  /** Coverage of products_json required to allow product hypotheses. */
  MIN_PRODUCTS_COVERAGE: 0.5,
} as const;

// -------- Deterministic hashing (djb2 → base36) ----------------------------
export function opaqueHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

/** Root-based provenance: identical across every layer describing the same fact. */
export function buildProvenanceKey(category: string, title: string): string {
  return `pk-${opaqueHash(`${category}::${normalizeTitle(title)}`)}`;
}

/** Fingerprint that identifies multiple layers derive from the same root fact. */
export function buildSourceFingerprint(category: string, title: string): string {
  return `sf-${opaqueHash(`fp::${category}::${normalizeTitle(title)}`)}`;
}
