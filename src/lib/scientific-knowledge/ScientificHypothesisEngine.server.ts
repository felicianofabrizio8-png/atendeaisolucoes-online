// ============================================================================
// ScientificHypothesisEngine — Agrega Observations por (category, title-normalized)
// em hipóteses científicas. Nunca promove diretamente para "validated" — apenas
// consolida ocorrências, primeira/última observação e confidence agregada.
// A promoção para status "validated" é responsabilidade do ValidationEngine.
// ============================================================================

import type {
  ObservationCategory,
  ScientificHypothesis,
  ScientificObservation,
} from "./ScientificKnowledgeTypes";
import { SCIENCE_THRESHOLDS } from "./ScientificKnowledgeTypes";

function normalizeKey(cat: ObservationCategory, title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${cat}::${slug || "untitled"}`;
}

export class ScientificHypothesisEngine {
  static build(observations: ScientificObservation[]): ScientificHypothesis[] {
    const groups = new Map<string, ScientificObservation[]>();
    for (const o of observations) {
      const key = normalizeKey(o.category, o.title);
      const bucket = groups.get(key);
      if (bucket) bucket.push(o);
      else groups.set(key, [o]);
    }

    const out: ScientificHypothesis[] = [];
    for (const [key, obs] of groups) {
      const sorted = [...obs].sort((a, b) =>
        a.observedAt.localeCompare(b.observedAt),
      );
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const occurrences = sorted.reduce((acc, o) => acc + Math.max(1, o.occurrences), 0);
      const avgConfidence =
        sorted.reduce((acc, o) => acc + o.confidence, 0) / sorted.length;

      let status: ScientificHypothesis["status"] = "observed";
      if (avgConfidence < SCIENCE_THRESHOLDS.DISCARD_CONFIDENCE_BELOW) {
        status = "discarded";
      } else if (avgConfidence < SCIENCE_THRESHOLDS.WEAKENING_CONFIDENCE_BELOW) {
        status = "weakening";
      } else if (sorted.length >= SCIENCE_THRESHOLDS.MIN_OCCURRENCES_FOR_STRENGTHENING) {
        status = "strengthening";
      }

      out.push({
        id: `hyp-${key}`,
        category: first.category,
        title: first.title,
        description: first.description,
        confidence: Number(avgConfidence.toFixed(4)),
        occurrences,
        firstObserved: first.observedAt,
        lastObserved: last.observedAt,
        supportingEvidence: [`ev-${key}`],
        status,
      });
    }

    return out;
  }
}
