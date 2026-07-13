// ============================================================================
// ScientificValidationEngine — Decide, com base em evidência agregada,
// se cada hipótese ganhou força, perdeu força, permaneceu igual ou deve ser
// descartada. Sem heurística subjetiva. Sem LLM.
//
// Também deriva o conjunto de "validated knowledge" — apenas hipóteses que
// atingem simultaneamente:
//   - occurrences >= MIN_OCCURRENCES_FOR_VALIDATED
//   - confidence  >= MIN_CONFIDENCE_FOR_VALIDATED
//   - histórico   >= MIN_HISTORY_SNAPSHOTS_FOR_VALIDATED (via Executive Knowledge)
// ============================================================================

import type { ExecutiveKnowledgeRecord } from "@/lib/executive-knowledge/ExecutiveKnowledgeTypes";
import type {
  ScientificEvidence,
  ScientificHypothesis,
  ScientificKnowledge,
} from "./ScientificKnowledgeTypes";
import { SCIENCE_THRESHOLDS } from "./ScientificKnowledgeTypes";

export interface ValidationResult {
  hypotheses: ScientificHypothesis[];
  validatedKnowledge: ScientificKnowledge[];
}

export class ScientificValidationEngine {
  static run(input: {
    hypotheses: ScientificHypothesis[];
    evidence: ScientificEvidence[];
    knowledgeTimelineSize: number;
    now: string;
  }): ValidationResult {
    const { hypotheses, evidence, knowledgeTimelineSize, now } = input;
    const evById = new Map(evidence.map((e) => [e.hypothesisId, e]));

    const updated: ScientificHypothesis[] = hypotheses.map((h) => {
      const ev = evById.get(h.id);
      const sample = ev?.sampleSize ?? h.occurrences;
      const conf = ev?.confidence ?? h.confidence;

      let status: ScientificHypothesis["status"] = h.status;

      if (conf < SCIENCE_THRESHOLDS.DISCARD_CONFIDENCE_BELOW) {
        status = "discarded";
      } else if (conf < SCIENCE_THRESHOLDS.WEAKENING_CONFIDENCE_BELOW) {
        status = "weakening";
      } else if (
        sample >= SCIENCE_THRESHOLDS.MIN_OCCURRENCES_FOR_VALIDATED &&
        conf >= SCIENCE_THRESHOLDS.MIN_CONFIDENCE_FOR_VALIDATED &&
        knowledgeTimelineSize >= SCIENCE_THRESHOLDS.MIN_HISTORY_SNAPSHOTS_FOR_VALIDATED
      ) {
        status = "validated";
      } else if (sample >= SCIENCE_THRESHOLDS.MIN_OCCURRENCES_FOR_STRENGTHENING) {
        status = "strengthening";
      } else {
        status = "observed";
      }

      return { ...h, status };
    });

    const validatedKnowledge: ScientificKnowledge[] = updated
      .filter((h) => h.status === "validated")
      .map((h) => ({
        id: `sk-${h.id}`,
        category: h.category,
        title: h.title,
        summary: h.description,
        confidence: h.confidence,
        validatedSince: h.firstObserved ?? now,
        supportingHypotheses: [h.id],
        supportingEvidence: h.supportingEvidence,
        status: "validated" as const,
      }));

    return { hypotheses: updated, validatedKnowledge };
  }
}
