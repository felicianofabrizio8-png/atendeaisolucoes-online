// ============================================================================
// ScientificObservationEngine — READ-ONLY. Deriva Observations com
// provenanceKey e sourceFingerprint. Confidence NUNCA fixa por origem.
// Occurrences = fatos independentes; deltas ficam em métricas separadas.
// ============================================================================

import type { BusinessBrainSnapshot } from "@/lib/business-brain/BusinessBrainTypes";
import type { BusinessLearningSnapshot } from "@/lib/business-learning/BusinessLearningTypes";
import type { ExecutiveKnowledgeRecord } from "@/lib/executive-knowledge/ExecutiveKnowledgeTypes";
import type {
  ObservationCategory,
  ScientificObservation,
  SciencePeriod,
} from "./ScientificKnowledgeTypes";
import {
  buildProvenanceKey,
  buildSourceFingerprint,
} from "./ScientificKnowledgeTypes";

function mapCategory(input: string): ObservationCategory {
  const allowed: ObservationCategory[] = [
    "objection",
    "buying_signal",
    "product",
    "channel",
    "timing",
    "conversion",
    "abandonment",
    "followup",
    "operational",
    "quality",
  ];
  return (allowed as string[]).includes(input)
    ? (input as ObservationCategory)
    : "operational";
}

function dayOf(iso: string): string {
  return (iso || "").slice(0, 10) || "0000-00-00";
}

/** Derive confidence from sample size (never fixed to 1). */
function derivedConfidence(sample: number, base: number | null): number {
  const s = Math.max(0, sample);
  const shape = 1 - Math.exp(-s / 10);
  if (base === null || base === undefined) return Number(shape.toFixed(4));
  // Blend supplied base (already ≤1) with sample shape; upper bound = base.
  return Number(Math.min(base, base * (0.4 + 0.6 * shape)).toFixed(4));
}

export class ScientificObservationEngine {
  static build(input: {
    brain: BusinessBrainSnapshot;
    learning: BusinessLearningSnapshot;
    knowledgeTimeline: ExecutiveKnowledgeRecord[];
    period: SciencePeriod;
    now: string;
    productsReady: boolean;
  }): ScientificObservation[] {
    const { brain, learning, knowledgeTimeline, period, now, productsReady } = input;
    const out: ScientificObservation[] = [];

    const push = (o: Omit<ScientificObservation, "provenanceKey" | "sourceFingerprint" | "observedDay">) => {
      // Fase 10: bloqueia observações de produto enquanto products_json não estiver populado.
      if (!productsReady && o.category === "product") return;
      out.push({
        ...o,
        observedDay: dayOf(o.observedAt),
        provenanceKey: buildProvenanceKey(o.category, o.title),
        sourceFingerprint: buildSourceFingerprint(o.category, o.title),
      });
    };

    for (const p of brain.patterns) {
      const cat = mapCategory(p.category);
      push({
        id: `obs-bb-pat-${p.id}`,
        category: cat,
        title: `Pattern: ${p.category}`,
        description: p.description,
        observedAt: p.lastObserved ?? now,
        occurrences: Math.max(1, p.occurrences),
        confidence: derivedConfidence(p.occurrences, p.confidence),
        source: "business_brain:pattern",
        period,
      });
    }

    for (const k of brain.knowledge) {
      const cat = mapCategory(k.category);
      push({
        id: `obs-bb-know-${k.id}`,
        category: cat,
        title: k.title,
        description: k.summary,
        observedAt: k.createdAt,
        occurrences: Math.max(1, k.evidence.sample),
        confidence: derivedConfidence(k.evidence.sample, k.confidence),
        source: "business_brain:knowledge",
        period,
      });
    }

    for (const t of brain.trends) {
      // Trends não são fatos — occurrences=1; delta vive em métricas.
      push({
        id: `obs-bb-trend-${t.id}`,
        category: "operational",
        title: `Trend: ${t.metric}`,
        description: `Direção ${t.direction}.`,
        observedAt: now,
        occurrences: 1,
        confidence: derivedConfidence(1, t.confidence),
        source: "business_brain:trend",
        period,
      });
    }

    for (const e of learning.evolution) {
      push({
        id: `obs-bl-evo-${e.id}`,
        category: "operational",
        title: `Evolução: ${e.metric}`,
        description: `${e.metric} direção ${e.direction}.`,
        observedAt: e.observedAt,
        occurrences: 1,
        confidence: derivedConfidence(1, e.confidence),
        source: "business_learning:evolution",
        period,
      });
    }

    for (const h of learning.hypotheses) {
      const cat = mapCategory(h.category);
      push({
        id: `obs-bl-hyp-${h.id}`,
        category: cat,
        title: h.title,
        description: h.description,
        observedAt: h.lastObserved ?? now,
        occurrences: Math.max(1, h.occurrences),
        confidence: derivedConfidence(h.occurrences, h.confidence),
        source: "business_learning:hypothesis",
        period,
      });
    }

    for (const l of learning.learning) {
      const cat = mapCategory(l.category);
      const sample = l.supportingPatterns.length + l.supportingKnowledge.length;
      push({
        id: `obs-bl-learn-${l.id}`,
        category: cat,
        title: l.title,
        description: l.summary,
        observedAt: l.createdAt,
        occurrences: Math.max(1, sample),
        confidence: derivedConfidence(sample, l.confidence),
        source: "business_learning:learning",
        period,
      });
    }

    for (const rec of knowledgeTimeline) {
      push({
        id: `obs-ek-${rec.id}`,
        category: "operational",
        title: `Snapshot ${rec.period}`,
        description: `Snapshot executivo.`,
        observedAt: rec.createdAt,
        occurrences: 1,
        // Fase 7: nunca confidence=1 fixa por origem.
        confidence: derivedConfidence(1, 0.5),
        source: "executive_knowledge:timeline",
        period,
      });
    }

    return out;
  }
}
