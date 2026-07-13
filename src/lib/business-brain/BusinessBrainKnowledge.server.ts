// ============================================================================
// BusinessBrainKnowledge — Gera unidades de conhecimento agregado + Trends,
// combinando métricas do Brain, Executive Snapshot e Executive Knowledge.
// Determinístico, sem LLM, sem PII.
// ============================================================================

import type {
  BrainMetrics,
  BrainPeriod,
  BusinessKnowledge,
  BusinessTrend,
  KnowledgeCategory,
  TrendDirection,
} from "./BusinessBrainTypes";
import type { ExecutiveDashboardBundle } from "@/lib/executive-ai/types";
import type { ExecutiveKnowledgeRecord } from "@/lib/executive-knowledge/ExecutiveKnowledgeTypes";

function id(cat: KnowledgeCategory, tag: string): string {
  return `know-${cat}-${tag}`;
}

function pushKnow(
  list: BusinessKnowledge[],
  entry: Omit<BusinessKnowledge, "createdAt">,
  createdAt: string,
): void {
  list.push({ ...entry, createdAt });
}

function computeDirection(current: number, previous: number): TrendDirection {
  const diff = current - previous;
  const base = Math.max(Math.abs(previous), 1);
  if (Math.abs(diff) / base < 0.05) return "flat";
  return diff > 0 ? "up" : "down";
}

export class BusinessBrainKnowledge {
  static buildKnowledge(
    metrics: BrainMetrics,
    executiveSnapshot: ExecutiveDashboardBundle | null,
    period: BrainPeriod,
    generatedAt: string,
  ): BusinessKnowledge[] {
    const list: BusinessKnowledge[] = [];
    const total = metrics.totalConversationsAnalyzed;

    // Knowledge não é gerado sem amostra mínima. Confiança segue a amostra.
    if (total >= 5) {
      const sold = metrics.byLifecycle.sold ?? 0;
      const rate = Math.round((sold / total) * 1000) / 10;
      pushKnow(
        list,
        {
          id: id("commercial", "conversion-rate"),
          category: "commercial",
          title: "Taxa de conversão agregada",
          summary: `Nas ${total} conversas analisadas no período ${period}, ${sold} resultaram em venda (${rate}%).`,
          confidence: Math.min(1, total / 30),
          evidence: { metrics: ["conversion_rate", "total_conversations"], sample: total },
        },
        generatedAt,
      );

      const abandoned = metrics.byLifecycle.abandoned ?? 0;
      if (abandoned > 0) {
        const ar = Math.round((abandoned / total) * 1000) / 10;
        pushKnow(
          list,
          {
            id: id("operational", "abandonment"),
            category: "operational",
            title: "Padrão de abandono observado",
            summary: `${ar}% das conversas terminam sem resposta útil do lead.`,
            confidence: Math.min(1, abandoned / 15),
            evidence: { metrics: ["abandonment_rate"], sample: abandoned },
          },
          generatedAt,
        );
      }

      if (metrics.topObjections.length > 0) {
        const top = metrics.topObjections[0];
        pushKnow(
          list,
          {
            id: id("commercial", "top-objection"),
            category: "commercial",
            title: "Objeção mais recorrente",
            summary: `A objeção "${top.key}" apareceu em ${top.percentage}% das conversas analisadas.`,
            confidence: Math.min(1, top.count / 15),
            evidence: { metrics: ["objection_frequency"], sample: top.count },
          },
          generatedAt,
        );
      }

      if (metrics.topProducts.length > 0) {
        const top = metrics.topProducts[0];
        pushKnow(
          list,
          {
            id: id("product", "top-mentioned"),
            category: "product",
            title: "Produto mais citado",
            summary: `"${top.key}" é o produto mais mencionado (${top.percentage}% das conversas).`,
            confidence: Math.min(1, top.count / 10),
            evidence: { metrics: ["product_mentions"], sample: top.count },
          },
          generatedAt,
        );
      }

      if (metrics.byChannel.length > 0) {
        const best = [...metrics.byChannel].sort((a, b) => b.sold - a.sold)[0];
        if (best && best.sold > 0) {
          pushKnow(
            list,
            {
              id: id("channel", `best-${best.channel}`),
              category: "channel",
              title: "Canal com maior número de vendas",
              summary: `O canal "${best.channel}" concentra ${best.sold} vendas em ${best.conversations} conversas analisadas.`,
              confidence: Math.min(1, best.conversations / 20),
              evidence: { metrics: ["channel_sales"], sample: best.conversations },
            },
            generatedAt,
          );
        }
      }

      if (metrics.timing.avgNegotiationMinutesToSale !== null) {
        pushKnow(
          list,
          {
            id: id("timing", "avg-neg-to-sale"),
            category: "timing",
            title: "Tempo médio até venda",
            summary: `Vendas fechadas exigem em média ${metrics.timing.avgNegotiationMinutesToSale} minutos de negociação.`,
            confidence: Math.min(1, (metrics.byLifecycle.sold ?? 0) / 10),
            evidence: {
              metrics: ["avg_negotiation_minutes_to_sale"],
              sample: metrics.byLifecycle.sold ?? 0,
            },
          },
          generatedAt,
        );
      }
    }

    // Quality — sinaliza se conjunto amostral está baixo.
    if (total < 5) {
      pushKnow(
        list,
        {
          id: id("quality", "low-sample"),
          category: "quality",
          title: "Amostra insuficiente para conclusões estáveis",
          summary: `Apenas ${total} conversas foram analisadas no período ${period}. Aumentar cobertura antes de derivar decisões.`,
          confidence: 1,
          evidence: { metrics: ["sample_size"], sample: total },
        },
        generatedAt,
      );
    }

    // Executive Snapshot — dado agregado já vem sem PII.
    if (executiveSnapshot) {
      const attn = executiveSnapshot.metrics.attendance;
      pushKnow(
        list,
        {
          id: id("operational", "response-time"),
          category: "operational",
          title: "Tempo médio de resposta (Executive)",
          summary: `Executive Intelligence reporta ${attn.avgResponseMinutes} minutos médios de resposta no período.`,
          confidence: 0.9,
          evidence: { metrics: ["executive.avgResponseMinutes"], sample: attn.attendedLeads },
        },
        generatedAt,
      );
    }

    return list;
  }

  static buildTrends(
    metrics: BrainMetrics,
    knowledgeRecent: ExecutiveKnowledgeRecord[],
    period: BrainPeriod,
  ): BusinessTrend[] {
    const trends: BusinessTrend[] = [];

    // Trend de conversão a partir da evolução semanal do Brain.
    const w = metrics.evolution.weekly;
    if (w.length >= 2) {
      const prev = w[w.length - 2];
      const curr = w[w.length - 1];
      const prevRate = prev.conversations > 0 ? (prev.sold / prev.conversations) * 100 : 0;
      const currRate = curr.conversations > 0 ? (curr.sold / curr.conversations) * 100 : 0;
      const delta = Math.round((currRate - prevRate) * 10) / 10;
      trends.push({
        id: `trend-brain-conversion-${period}`,
        metric: "conversion_rate_weekly",
        direction: computeDirection(currRate, prevRate),
        delta,
        percentDelta: prevRate > 0 ? Math.round(((currRate - prevRate) / prevRate) * 1000) / 10 : null,
        period,
        confidence: Math.min(1, Math.min(prev.conversations, curr.conversations) / 10),
      });
    }

    // Trend de volume analisado a partir do Executive Knowledge.
    if (knowledgeRecent.length >= 2) {
      const curr = knowledgeRecent[0];
      const prev = knowledgeRecent[1];
      const c = curr.facts.attendance.newLeads;
      const p = prev.facts.attendance.newLeads;
      trends.push({
        id: `trend-executive-new-leads-${period}`,
        metric: "executive.newLeads",
        direction: computeDirection(c, p),
        delta: c - p,
        percentDelta: p > 0 ? Math.round(((c - p) / p) * 1000) / 10 : null,
        period,
        confidence: 0.7,
      });

      const cResp = curr.facts.attendance.avgResponseMinutes;
      const pResp = prev.facts.attendance.avgResponseMinutes;
      trends.push({
        id: `trend-executive-response-${period}`,
        metric: "executive.avgResponseMinutes",
        direction: computeDirection(cResp, pResp),
        delta: Math.round((cResp - pResp) * 10) / 10,
        percentDelta: pResp > 0 ? Math.round(((cResp - pResp) / pResp) * 1000) / 10 : null,
        period,
        confidence: 0.7,
      });
    }

    return trends;
  }
}
