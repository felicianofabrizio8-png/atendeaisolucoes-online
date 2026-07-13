// ============================================================================
// ScientificValidationEngine — Regras determinísticas de status, contradições,
// theories e scientificScore. Sem heurística subjetiva. Sem LLM.
//
// Validated exige simultaneamente:
//   • sampleSize (fatos independentes)      ≥ MIN_OCCURRENCES_FOR_VALIDATED
//   • distinctDays (dias reais)             ≥ MIN_DISTINCT_DAYS_FOR_VALIDATED
//   • confidence                            ≥ MIN_CONFIDENCE_FOR_VALIDATED
//   • distinctSnapshotDays (histórico real) ≥ MIN_HISTORY_SNAPSHOT_DAYS_FOR_VALIDATED
//
// Discarded APENAS quando existir contradição histórica; nunca por amostra pequena.
// ============================================================================

import type {
  ScientificEvidence,
  ScientificHypothesis,
  ScientificKnowledge,
  ScientificTheory,
} from "./ScientificKnowledgeTypes";
import { SCIENCE_THRESHOLDS } from "./ScientificKnowledgeTypes";

export interface ValidationResult {
  hypotheses: ScientificHypothesis[];
  theories: ScientificTheory[];
  validatedKnowledge: ScientificKnowledge[];
}

function detectContradictions(hs: ScientificHypothesis[]): Set<string> {
  // Fase 12: dentro de uma mesma categoria, se dois provenanceKeys distintos
  // dominam o topo em janelas temporais diferentes, ambos ficam sinalizados.
  const flagged = new Set<string>();
  const byCat = new Map<string, ScientificHypothesis[]>();
  for (const h of hs) {
    const list = byCat.get(h.category) ?? [];
    list.push(h);
    byCat.set(h.category, list);
  }
  for (const [, list] of byCat) {
    if (list.length < 2) continue;
    // Compara janelas: quem "domina" no início vs no fim.
    const early = [...list].sort((a, b) =>
      (a.firstObserved ?? "").localeCompare(b.firstObserved ?? ""),
    );
    const late = [...list].sort((a, b) =>
      (b.lastObserved ?? "").localeCompare(a.lastObserved ?? ""),
    );
    const topEarly = early[0];
    const topLate = late[0];
    if (
      topEarly &&
      topLate &&
      topEarly.provenanceKey !== topLate.provenanceKey &&
      topEarly.distinctDays >= 1 &&
      topLate.distinctDays >= 1
    ) {
      flagged.add(topEarly.provenanceKey);
      flagged.add(topLate.provenanceKey);
    }
  }
  return flagged;
}

function scientificScoreOf(input: {
  sample: number;
  distinctDays: number;
  historyDays: number;
  confidence: number;
  contradiction: boolean;
  provenance: string;
}): number {
  const sampleScore = Math.min(1, input.sample / 10);
  const tempoScore = Math.min(1, input.distinctDays / 5);
  const historyScore = Math.min(1, input.historyDays / 5);
  const provenanceScore = input.provenance ? 1 : 0;
  const contradictionPenalty = input.contradiction ? 0.5 : 1;
  const raw =
    0.25 * sampleScore +
    0.25 * tempoScore +
    0.20 * historyScore +
    0.25 * input.confidence +
    0.05 * provenanceScore;
  return Number((raw * contradictionPenalty).toFixed(4));
}

export class ScientificValidationEngine {
  static run(input: {
    hypotheses: ScientificHypothesis[];
    evidence: ScientificEvidence[];
    distinctSnapshotDays: number;
    now: string;
  }): ValidationResult {
    const { hypotheses, evidence, distinctSnapshotDays, now } = input;
    const evByHyp = new Map(evidence.map((e) => [e.hypothesisId, e]));
    const contradicted = detectContradictions(hypotheses);

    const updated: ScientificHypothesis[] = hypotheses.map((h) => {
      const ev = evByHyp.get(h.id);
      const sample = ev?.sampleSize ?? h.occurrences;
      const days = ev?.distinctDays ?? h.distinctDays;
      const conf = ev?.confidence ?? h.confidence;
      const isContradicted = contradicted.has(h.provenanceKey);

      let status: ScientificHypothesis["status"] = h.status;

      if (isContradicted && distinctSnapshotDays >= SCIENCE_THRESHOLDS.MIN_HISTORY_SNAPSHOT_DAYS_FOR_VALIDATED) {
        // Fase 5: discarded APENAS com contradição histórica real.
        status = "discarded";
      } else if (conf < SCIENCE_THRESHOLDS.WEAKENING_CONFIDENCE_BELOW) {
        status = "weakening";
      } else if (
        sample >= SCIENCE_THRESHOLDS.MIN_OCCURRENCES_FOR_VALIDATED &&
        days >= SCIENCE_THRESHOLDS.MIN_DISTINCT_DAYS_FOR_VALIDATED &&
        conf >= SCIENCE_THRESHOLDS.MIN_CONFIDENCE_FOR_VALIDATED &&
        distinctSnapshotDays >= SCIENCE_THRESHOLDS.MIN_HISTORY_SNAPSHOT_DAYS_FOR_VALIDATED
      ) {
        status = "validated";
      } else if (
        sample >= SCIENCE_THRESHOLDS.MIN_OCCURRENCES_FOR_STRENGTHENING &&
        days >= SCIENCE_THRESHOLDS.MIN_DISTINCT_DAYS_FOR_STRENGTHENING
      ) {
        status = "strengthening";
      } else if (sample >= SCIENCE_THRESHOLDS.MIN_OCCURRENCES_FOR_STRENGTHENING) {
        status = "insufficient_history";
      } else {
        status = "observed";
      }

      return { ...h, status, contradictionDetected: isContradicted };
    });

    // Fase 11: Theory = hipótese com repetição temporal, ainda não consolidada.
    const theories: ScientificTheory[] = updated
      .filter(
        (h) =>
          h.distinctDays >= SCIENCE_THRESHOLDS.MIN_DISTINCT_DAYS_FOR_STRENGTHENING &&
          (h.status === "strengthening" || h.status === "validated"),
      )
      .map((h) => ({
        id: `th-${h.provenanceKey}`,
        hypothesisId: h.id,
        category: h.category,
        title: h.title,
        distinctDays: h.distinctDays,
        confidence: h.confidence,
        provenanceKey: h.provenanceKey,
      }));

    const validatedKnowledge: ScientificKnowledge[] = updated
      .filter((h) => h.status === "validated")
      .map((h) => {
        const ev = evByHyp.get(h.id);
        const score = scientificScoreOf({
          sample: ev?.sampleSize ?? h.occurrences,
          distinctDays: ev?.distinctDays ?? h.distinctDays,
          historyDays: distinctSnapshotDays,
          confidence: h.confidence,
          contradiction: h.contradictionDetected,
          provenance: h.provenanceKey,
        });
        return {
          id: `sk-${h.provenanceKey}`,
          category: h.category,
          title: h.title,
          summary: h.description,
          confidence: h.confidence,
          scientificScore: score,
          validatedSince: h.firstObserved ?? now,
          supportingHypotheses: [h.id],
          supportingEvidence: h.supportingEvidence,
          provenanceKey: h.provenanceKey,
          status: "validated" as const,
        };
      });

    return { hypotheses: updated, theories, validatedKnowledge };
  }
}
