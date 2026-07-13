// ============================================================================
// BusinessLearningEvolution — Detecta crescimento, queda, estabilidade,
// surgimento e desaparecimento comparando dois momentos:
//   1) buckets semanais/mensais do Business Brain (previous vs current);
//   2) snapshots consecutivos do Executive Knowledge.
// 100% determinístico. Sem LLM. Sem PII.
// ============================================================================

import type { BusinessBrainSnapshot } from "@/lib/business-brain/BusinessBrainTypes";
import type { ExecutiveKnowledgeRecord } from "@/lib/executive-knowledge/ExecutiveKnowledgeTypes";
import type {
  BusinessEvolution,
  EvolutionDirection,
  LearningPeriod,
} from "./BusinessLearningTypes";

const EMERGING_THRESHOLD = 0.05; // <5% do total sinaliza "muito baixo"
const STABLE_ABS_PCT = 5; // até 5% de variação é considerado estável
const MIN_SAMPLE = 3;

function slug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function computeDirection(
  previous: number,
  current: number,
): EvolutionDirection {
  if (previous <= 0 && current > 0) return "emerging";
  if (previous > 0 && current <= 0) return "disappearing";
  if (previous === 0 && current === 0) return "stable";
  const base = Math.max(Math.abs(previous), 1);
  const pct = ((current - previous) / base) * 100;
  if (Math.abs(pct) <= STABLE_ABS_PCT) return "stable";
  return pct > 0 ? "rising" : "falling";
}

function makeEvolution(
  id: string,
  metric: string,
  previous: number,
  current: number,
  periodCompared: string,
  observedAt: string,
  confidence: number,
  sample: number,
): BusinessEvolution {
  const delta = Math.round((current - previous) * 100) / 100;
  const deltaPercent =
    previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;
  // Guard: sem amostra mínima nenhum direction é confiável.
  const direction: EvolutionDirection =
    sample < MIN_SAMPLE ? "insufficient_sample" : computeDirection(previous, current);
  const guardedConfidence =
    sample < MIN_SAMPLE ? 0 : Math.max(0, Math.min(1, confidence));
  return {
    id,
    metric,
    previousValue: previous,
    currentValue: current,
    delta,
    deltaPercent,
    direction,
    confidence: guardedConfidence,
    periodCompared,
    observedAt,
  };
}

function confidenceFor(sample: number): number {
  if (sample <= 0) return 0;
  return Math.round(Math.min(1, sample / 20) * 100) / 100;
}

export class BusinessLearningEvolution {
  static build(
    brain: BusinessBrainSnapshot,
    knowledgeTimeline: ExecutiveKnowledgeRecord[],
    period: LearningPeriod,
    now: string,
  ): BusinessEvolution[] {
    const evolutions: BusinessEvolution[] = [];

    // ---- Evolução por buckets semanais do Brain ----------------------------
    const weeks = brain.metrics.evolution.weekly;
    if (weeks.length >= 2) {
      const prev = weeks[weeks.length - 2];
      const curr = weeks[weeks.length - 1];
      const cmp = `week:${prev.bucket}→${curr.bucket}`;
      evolutions.push(
        makeEvolution(
          `evo-brain-conversations-${period}`,
          "brain.weekly.conversations",
          prev.conversations,
          curr.conversations,
          cmp,
          now,
          confidenceFor(prev.conversations + curr.conversations),
          prev.conversations + curr.conversations,
        ),
      );
      evolutions.push(
        makeEvolution(
          `evo-brain-sold-${period}`,
          "brain.weekly.sold",
          prev.sold,
          curr.sold,
          cmp,
          now,
          confidenceFor(prev.sold + curr.sold),
          prev.sold + curr.sold,
        ),
      );
      evolutions.push(
        makeEvolution(
          `evo-brain-lost-${period}`,
          "brain.weekly.lost",
          prev.lost,
          curr.lost,
          cmp,
          now,
          confidenceFor(prev.lost + curr.lost),
          prev.lost + curr.lost,
        ),
      );
    }

    // ---- Evolução por buckets mensais --------------------------------------
    const months = brain.metrics.evolution.monthly;
    if (months.length >= 2) {
      const prev = months[months.length - 2];
      const curr = months[months.length - 1];
      const cmp = `month:${prev.bucket}→${curr.bucket}`;
      evolutions.push(
        makeEvolution(
          `evo-brain-monthly-conversations-${period}`,
          "brain.monthly.conversations",
          prev.conversations,
          curr.conversations,
          cmp,
          now,
          confidenceFor(prev.conversations + curr.conversations),
          prev.conversations + curr.conversations,
        ),
      );
    }

    // ---- Evolução do Executive Knowledge (2 snapshots consecutivos) --------
    if (knowledgeTimeline.length >= 2) {
      const curr = knowledgeTimeline[0];
      const prev = knowledgeTimeline[1];
      const cmp = `executive:${prev.snapshotGeneratedAt}→${curr.snapshotGeneratedAt}`;

      const pairs: Array<{ metric: string; p: number; c: number; sample: number }> = [
        {
          metric: "executive.newLeads",
          p: prev.facts.attendance.newLeads,
          c: curr.facts.attendance.newLeads,
          sample: prev.facts.attendance.newLeads + curr.facts.attendance.newLeads,
        },
        {
          metric: "executive.attendedLeads",
          p: prev.facts.attendance.attendedLeads,
          c: curr.facts.attendance.attendedLeads,
          sample: prev.facts.attendance.attendedLeads + curr.facts.attendance.attendedLeads,
        },
        {
          metric: "executive.avgResponseMinutes",
          p: prev.facts.attendance.avgResponseMinutes,
          c: curr.facts.attendance.avgResponseMinutes,
          sample: prev.facts.attendance.attendedLeads + curr.facts.attendance.attendedLeads,
        },
        {
          metric: "executive.conversionRate",
          p: prev.facts.attendance.conversionRate,
          c: curr.facts.attendance.conversionRate,
          sample: prev.facts.attendance.attendedLeads + curr.facts.attendance.attendedLeads,
        },
        {
          metric: "executive.quotesIssued",
          p: prev.facts.sales.quotesIssued,
          c: curr.facts.sales.quotesIssued,
          sample: prev.facts.sales.quotesIssued + curr.facts.sales.quotesIssued,
        },
        {
          metric: "executive.closedCount",
          p: prev.facts.sales.closedCount,
          c: curr.facts.sales.closedCount,
          sample: prev.facts.sales.closedCount + curr.facts.sales.closedCount,
        },
        {
          metric: "executive.followups.pending",
          p: prev.facts.followups.pending,
          c: curr.facts.followups.pending,
          sample: prev.facts.followups.pending + curr.facts.followups.pending,
        },
      ];
      for (const pr of pairs) {
        evolutions.push(
          makeEvolution(
            `evo-${slug(pr.metric)}-${period}`,
            pr.metric,
            pr.p,
            pr.c,
            cmp,
            now,
            confidenceFor(pr.sample),
          ),
        );
      }
    }

    // ---- Emerging / Disappearing por trend do próprio Brain ----------------
    for (const t of brain.trends) {
      if (t.direction === "flat") continue;
      const previous = t.delta > 0 ? Math.max(0, 0) : Math.max(0, Math.abs(t.delta));
      const current = t.delta > 0 ? Math.max(0, t.delta) : 0;
      // Trend do Brain já foi comparado; apenas repasse como evolução informativa.
      evolutions.push({
        id: `evo-trend-${slug(t.metric)}-${period}`,
        metric: `brain.trend.${t.metric}`,
        previousValue: previous,
        currentValue: current,
        delta: t.delta,
        deltaPercent: t.percentDelta,
        direction: t.direction === "up" ? "rising" : "falling",
        confidence: t.confidence,
        periodCompared: `trend:${t.period}`,
        observedAt: now,
      });
    }

    // Ignora ruído: quando sample e valores são triviais, o item permanece
    // como "stable" com confidence baixa — não é filtrado, mas o consumidor
    // pode usar confidence.
    void EMERGING_THRESHOLD;
    void MIN_SAMPLE;

    return evolutions;
  }
}
