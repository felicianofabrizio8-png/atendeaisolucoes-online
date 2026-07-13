// ============================================================================
// ScientificEvidenceEngine — Agrega, para cada hipótese, as evidências
// numéricas oriundas das camadas anteriores. Nunca armazena mensagens,
// clientes ou IDs externos. Somente métricas e IDs internos das camadas
// permitidas.
// ============================================================================

import type { BusinessBrainSnapshot } from "@/lib/business-brain/BusinessBrainTypes";
import type { BusinessLearningSnapshot } from "@/lib/business-learning/BusinessLearningTypes";
import type {
  ScientificEvidence,
  ScientificHypothesis,
  ScientificObservation,
} from "./ScientificKnowledgeTypes";

export class ScientificEvidenceEngine {
  static build(input: {
    hypotheses: ScientificHypothesis[];
    observations: ScientificObservation[];
    brain: BusinessBrainSnapshot;
    learning: BusinessLearningSnapshot;
  }): ScientificEvidence[] {
    const { hypotheses, observations, brain, learning } = input;
    const byHypothesis = new Map<string, ScientificObservation[]>();
    for (const h of hypotheses) {
      byHypothesis.set(h.id, []);
    }
    // Map observations back to their hypothesis by category+title.
    const keyFor = (o: ScientificObservation) =>
      hypotheses.find(
        (h) => h.category === o.category && h.title === o.title,
      )?.id ?? null;

    for (const o of observations) {
      const hid = keyFor(o);
      if (hid) byHypothesis.get(hid)?.push(o);
    }

    const evidence: ScientificEvidence[] = [];
    for (const h of hypotheses) {
      const related = byHypothesis.get(h.id) ?? [];
      const patternIds: string[] = [];
      const knowledgeIds: string[] = [];
      const learningIds: string[] = [];
      const metricSet = new Set<string>();

      for (const o of related) {
        switch (o.source) {
          case "business_brain:pattern": {
            const raw = o.id.replace(/^obs-bb-pat-/, "");
            patternIds.push(raw);
            const p = brain.patterns.find((x) => x.id === raw);
            if (p) metricSet.add(`pattern:${p.category}`);
            break;
          }
          case "business_brain:knowledge": {
            const raw = o.id.replace(/^obs-bb-know-/, "");
            knowledgeIds.push(raw);
            const k = brain.knowledge.find((x) => x.id === raw);
            if (k) k.evidence.metrics.forEach((m) => metricSet.add(m));
            break;
          }
          case "business_brain:trend": {
            const raw = o.id.replace(/^obs-bb-trend-/, "");
            const t = brain.trends.find((x) => x.id === raw);
            if (t) metricSet.add(`trend:${t.metric}`);
            break;
          }
          case "business_learning:evolution": {
            const raw = o.id.replace(/^obs-bl-evo-/, "");
            const e = learning.evolution.find((x) => x.id === raw);
            if (e) metricSet.add(`evolution:${e.metric}`);
            break;
          }
          case "business_learning:hypothesis": {
            const raw = o.id.replace(/^obs-bl-hyp-/, "");
            const bh = learning.hypotheses.find((x) => x.id === raw);
            if (bh) bh.evidence.metrics.forEach((m) => metricSet.add(m));
            break;
          }
          case "business_learning:learning": {
            const raw = o.id.replace(/^obs-bl-learn-/, "");
            learningIds.push(raw);
            const l = learning.learning.find((x) => x.id === raw);
            if (l) metricSet.add(`learning:${l.category}`);
            break;
          }
          case "executive_knowledge:timeline": {
            metricSet.add("executive_snapshot");
            break;
          }
        }
      }

      const sampleSize = related.reduce(
        (acc, o) => acc + Math.max(1, o.occurrences),
        0,
      );
      const confidence =
        related.length === 0
          ? 0
          : related.reduce((acc, o) => acc + o.confidence, 0) / related.length;

      evidence.push({
        id: h.supportingEvidence[0] ?? `ev-${h.id}`,
        hypothesisId: h.id,
        metrics: Array.from(metricSet).sort(),
        patterns: Array.from(new Set(patternIds)).sort(),
        knowledge: Array.from(new Set(knowledgeIds)).sort(),
        learning: Array.from(new Set(learningIds)).sort(),
        sampleSize,
        confidence: Number(confidence.toFixed(4)),
      });
    }

    return evidence;
  }
}
