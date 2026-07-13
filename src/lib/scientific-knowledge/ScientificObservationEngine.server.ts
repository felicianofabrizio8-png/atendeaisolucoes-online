// ============================================================================
// ScientificObservationEngine — Converte fatos observados nas camadas
// anteriores (Business Brain, Business Learning, Executive Knowledge Timeline)
// em Observations determinísticas. READ-ONLY. Sem PII.
// ============================================================================

import type { BusinessBrainSnapshot } from "@/lib/business-brain/BusinessBrainTypes";
import type { BusinessLearningSnapshot } from "@/lib/business-learning/BusinessLearningTypes";
import type { ExecutiveKnowledgeRecord } from "@/lib/executive-knowledge/ExecutiveKnowledgeTypes";
import type {
  ObservationCategory,
  ScientificObservation,
  SciencePeriod,
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

export class ScientificObservationEngine {
  static build(input: {
    brain: BusinessBrainSnapshot;
    learning: BusinessLearningSnapshot;
    knowledgeTimeline: ExecutiveKnowledgeRecord[];
    period: SciencePeriod;
    now: string;
  }): ScientificObservation[] {
    const { brain, learning, knowledgeTimeline, period, now } = input;
    const out: ScientificObservation[] = [];

    // -- From Business Brain patterns ------------------------------------
    for (const p of brain.patterns) {
      out.push({
        id: `obs-bb-pat-${p.id}`,
        category: mapCategory(p.category),
        title: `Pattern: ${p.category}`,
        description: p.description,
        observedAt: p.lastObserved ?? now,
        occurrences: p.occurrences,
        confidence: p.confidence,
        source: "business_brain:pattern",
        period,
      });
    }

    // -- From Business Brain knowledge -----------------------------------
    for (const k of brain.knowledge) {
      out.push({
        id: `obs-bb-know-${k.id}`,
        category: mapCategory(k.category),
        title: k.title,
        description: k.summary,
        observedAt: k.createdAt,
        occurrences: k.evidence.sample,
        confidence: k.confidence,
        source: "business_brain:knowledge",
        period,
      });
    }

    // -- From Business Brain trends --------------------------------------
    for (const t of brain.trends) {
      out.push({
        id: `obs-bb-trend-${t.id}`,
        category: "operational",
        title: `Trend: ${t.metric}`,
        description: `Direção ${t.direction} com delta ${t.delta}${
          t.percentDelta !== null ? ` (${t.percentDelta}%)` : ""
        }.`,
        observedAt: now,
        occurrences: Math.abs(t.delta),
        confidence: t.confidence,
        source: "business_brain:trend",
        period,
      });
    }

    // -- From Business Learning evolutions -------------------------------
    for (const e of learning.evolution) {
      out.push({
        id: `obs-bl-evo-${e.id}`,
        category: "operational",
        title: `Evolução: ${e.metric}`,
        description: `${e.metric} ${e.direction} (${e.previousValue}→${e.currentValue}).`,
        observedAt: e.observedAt,
        occurrences: 1,
        confidence: e.confidence,
        source: "business_learning:evolution",
        period,
      });
    }

    // -- From Business Learning hypotheses -------------------------------
    for (const h of learning.hypotheses) {
      out.push({
        id: `obs-bl-hyp-${h.id}`,
        category: mapCategory(h.category),
        title: h.title,
        description: h.description,
        observedAt: h.lastObserved ?? now,
        occurrences: h.occurrences,
        confidence: h.confidence,
        source: "business_learning:hypothesis",
        period,
      });
    }

    // -- From Business Learning learnings --------------------------------
    for (const l of learning.learning) {
      out.push({
        id: `obs-bl-learn-${l.id}`,
        category: mapCategory(l.category),
        title: l.title,
        description: l.summary,
        observedAt: l.createdAt,
        occurrences: l.supportingPatterns.length + l.supportingKnowledge.length,
        confidence: l.confidence,
        source: "business_learning:learning",
        period,
      });
    }

    // -- From Executive Knowledge Timeline (aggregate only) --------------
    for (const rec of knowledgeTimeline) {
      out.push({
        id: `obs-ek-${rec.periodLabel}`,
        category: "operational",
        title: `Snapshot ${rec.periodLabel}`,
        description: `Snapshot executivo com ${rec.facts.attendance.avgResponseMinutes}min de resposta média.`,
        observedAt: rec.createdAt,
        occurrences: 1,
        confidence: 1,
        source: "executive_knowledge:timeline",
        period,
      });
    }

    return out;
  }
}
