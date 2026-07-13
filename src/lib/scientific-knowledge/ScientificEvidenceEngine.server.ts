// ============================================================================
// ScientificEvidenceEngine — Colapsa observações da mesma linhagem em UMA
// única evidência por provenanceKey. Nunca expõe IDs internos no payload
// público (patterns/knowledge/learning) — apenas rótulos de camadas.
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

    const byPk = new Map<string, ScientificObservation[]>();
    for (const o of observations) {
      const list = byPk.get(o.provenanceKey) ?? [];
      list.push(o);
      byPk.set(o.provenanceKey, list);
    }

    const evidence: ScientificEvidence[] = [];
    for (const h of hypotheses) {
      const related = byPk.get(h.provenanceKey) ?? [];
      const metricSet = new Set<string>();
      const sources = new Set<ScientificObservation["source"]>();
      const factRoots = new Set<string>();
      const days = new Set<string>();

      for (const o of related) {
        sources.add(o.source);
        days.add(o.observedDay);
        // Fase 3: sampleSize = fatos independentes (dedupe por source+id-root).
        factRoots.add(`${o.source}#${o.id}`);
        // Métricas agregadas — labels apenas, sem IDs.
        switch (o.source) {
          case "business_brain:pattern": {
            const raw = o.id.replace(/^obs-bb-pat-/, "");
            const p = brain.patterns.find((x) => x.id === raw);
            if (p) metricSet.add(`pattern:${p.category}`);
            break;
          }
          case "business_brain:knowledge": {
            const raw = o.id.replace(/^obs-bb-know-/, "");
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

      const confidence =
        related.length === 0
          ? 0
          : related.reduce((acc, o) => acc + o.confidence, 0) / related.length;

      evidence.push({
        id: `ev-${h.provenanceKey}`,
        hypothesisId: h.id,
        provenanceKey: h.provenanceKey,
        sourceFingerprint: related[0]?.sourceFingerprint ?? h.provenanceKey,
        metrics: Array.from(metricSet).sort(),
        sources: Array.from(sources).sort(),
        sampleSize: factRoots.size,
        distinctDays: days.size,
        confidence: Number(confidence.toFixed(4)),
      });
    }

    return evidence;
  }
}
