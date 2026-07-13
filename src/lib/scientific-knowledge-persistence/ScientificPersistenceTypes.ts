// ============================================================================
// Scientific Persistence — Types
// ============================================================================

import type {
  ScientificKnowledgeSnapshot,
  SciencePeriod,
} from "@/lib/scientific-knowledge/ScientificKnowledgeTypes";

export const SCIENTIFIC_ENGINE_VERSION = "scientific-v1.0.0" as const;

export interface ScientificQualityReport {
  totalObservations: number;
  totalHypotheses: number;
  totalEvidence: number;
  totalTheories: number;
  totalValidatedKnowledge: number;
  insufficientHistoryCount: number;
  contradictionsCount: number;
  duplicateLineagesCollapsed: number;
  productsReady: boolean;
  distinctHistoryDays: number;
  warnings: string[];
  generatedAt: string;
}

export interface ScientificPersistencePlan {
  companyId: string;
  period: SciencePeriod;
  engineVersion: string;
  snapshotDate: string; // YYYY-MM-DD
  sourceFingerprint: string;
  snapshot: ScientificKnowledgeSnapshot;
  quality: ScientificQualityReport;
  changes: {
    snapshotWouldInsert: boolean;
    snapshotAlreadyExists: boolean;
    hypothesesInsert: number;
    hypothesesUpdate: number;
    hypothesesSameDay: number; // day-day dedup
    knowledgeInsert: number;
    knowledgeUpdate: number;
    knowledgeCandidates: number;
    knowledgeValidated: number;
    knowledgeHistorical: number;
    knowledgeDeprecated: number;
    contradictionsIncrement: number;
  };
}

export interface ScientificPersistenceResult extends ScientificPersistencePlan {
  applied: boolean;
  snapshotId: string | null;
}
