// ============================================================================
// ScientificHypothesisEngine — Agrega Observations por provenanceKey.
// Strengthening SOMENTE com repetição temporal (≥ N dias distintos).
// Nunca fortalece por intra-execução. Nunca promove a validated aqui.
// ============================================================================

import type {
  ScientificHypothesis,
  ScientificObservation,
} from "./ScientificKnowledgeTypes";
import { SCIENCE_THRESHOLDS } from "./ScientificKnowledgeTypes";

export class ScientificHypothesisEngine {
  static build(observations: ScientificObservation[]): ScientificHypothesis[] {
    const groups = new Map<string, ScientificObservation[]>();
    for (const o of observations) {
      const bucket = groups.get(o.provenanceKey);
      if (bucket) bucket.push(o);
      else groups.set(o.provenanceKey, [o]);
    }

    const out: ScientificHypothesis[] = [];
    for (const [pk, obs] of groups) {
      const sorted = [...obs].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];

      // Fase 3+8: fatos independentes deduplicados por (source, id).
      const factKeys = new Set(sorted.map((o) => `${o.source}#${o.id}`));
      const occurrences = factKeys.size;

      // Fase 6: dias distintos reais.
      const distinctDays = new Set(sorted.map((o) => o.observedDay)).size;

      const avgConfidence =
        sorted.reduce((acc, o) => acc + o.confidence, 0) / sorted.length;

      let status: ScientificHypothesis["status"] = "observed";
      if (avgConfidence < SCIENCE_THRESHOLDS.DISCARD_CONFIDENCE_BELOW) {
        // Fase 5: discarded exige contradição histórica; aqui só sinaliza fraqueza.
        status = "weakening";
      } else if (avgConfidence < SCIENCE_THRESHOLDS.WEAKENING_CONFIDENCE_BELOW) {
        status = "weakening";
      } else if (
        occurrences >= SCIENCE_THRESHOLDS.MIN_OCCURRENCES_FOR_STRENGTHENING &&
        distinctDays >= SCIENCE_THRESHOLDS.MIN_DISTINCT_DAYS_FOR_STRENGTHENING
      ) {
        status = "strengthening";
      } else if (
        occurrences >= SCIENCE_THRESHOLDS.MIN_OCCURRENCES_FOR_STRENGTHENING &&
        distinctDays < SCIENCE_THRESHOLDS.MIN_DISTINCT_DAYS_FOR_STRENGTHENING
      ) {
        // Fase 5: amostra ok, mas sem histórico temporal.
        status = "insufficient_history";
      }

      out.push({
        id: `hyp-${pk}`,
        category: first.category,
        title: first.title,
        description: first.description,
        confidence: Number(avgConfidence.toFixed(4)),
        occurrences,
        firstObserved: first.observedAt,
        lastObserved: last.observedAt,
        distinctDays,
        supportingEvidence: [`ev-${pk}`],
        status,
        provenanceKey: pk,
        contradictionDetected: false,
      });
    }

    return out;
  }
}
