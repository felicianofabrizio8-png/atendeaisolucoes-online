// ============================================================================
// BusinessBrainPatterns — Deriva Patterns determinísticos a partir das métricas
// e do próprio conjunto de facts. Sem LLM, sem PII, sem strings de mensagens.
// ============================================================================

import type {
  BrainMetrics,
  BusinessPattern,
  PatternCategory,
  Trend,
} from "./BusinessBrainTypes";
import type { RawFactRow } from "./BusinessBrainAnalyzer.server";

function slug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extremesInWindow(dates: string[]): { first: string | null; last: string | null } {
  let first: string | null = null;
  let last: string | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!first || d < first) first = d;
    if (!last || d > last) last = d;
  }
  return { first, last };
}

/** trend calculado por comparação simples entre metade inicial x metade final da amostra */
function computeTrend(rows: RawFactRow[], predicate: (r: RawFactRow) => boolean): Trend {
  if (rows.length < 4) return "stable";
  const sorted = [...rows].sort((a, b) =>
    (a.analyzed_at ?? "") < (b.analyzed_at ?? "") ? -1 : 1,
  );
  const mid = Math.floor(sorted.length / 2);
  const first = sorted.slice(0, mid).filter(predicate).length;
  const second = sorted.slice(mid).filter(predicate).length;
  if (second > first * 1.2) return "rising";
  if (second < first * 0.8) return "falling";
  return "stable";
}

function confidenceFor(count: number, total: number): number {
  if (total <= 0) return 0;
  const share = count / total;
  const volumeFactor = Math.min(1, count / 20); // saturado em 20 ocorrências
  return Math.round(Math.min(1, share * 0.6 + volumeFactor * 0.4) * 100) / 100;
}

function patternId(cat: PatternCategory, key: string): string {
  return `pat-${cat}-${slug(key).slice(0, 40) || "generic"}`;
}

export class BusinessBrainPatterns {
  static build(rows: RawFactRow[], metrics: BrainMetrics): BusinessPattern[] {
    const total = metrics.totalConversationsAnalyzed;
    const patterns: BusinessPattern[] = [];
    if (total === 0) return patterns;

    // -------- Objeções --------------------------------------------------------
    for (const item of metrics.topObjections.slice(0, 5)) {
      const matching = rows.filter(
        (r) => (r.objections_json ?? []).some((o) => String(o).toLowerCase() === item.key),
      );
      const { first, last } = extremesInWindow(matching.map((r) => r.analyzed_at));
      patterns.push({
        id: patternId("objection", item.key),
        category: "objection",
        description: `Objeção "${item.key}" observada em ${item.count} de ${total} conversas (${item.percentage}%).`,
        occurrences: item.count,
        confidence: confidenceFor(item.count, total),
        firstObserved: first,
        lastObserved: last,
        trend: computeTrend(rows, (r) =>
          (r.objections_json ?? []).some((o) => String(o).toLowerCase() === item.key),
        ),
        evidence: {
          conversations: item.count,
          percentage: item.percentage,
          reference: `sample=${total}`,
        },
      });
    }

    // -------- Buying signals --------------------------------------------------
    for (const item of metrics.topBuyingSignals.slice(0, 5)) {
      const matching = rows.filter(
        (r) => (r.buying_signals_json ?? []).some((o) => String(o).toLowerCase() === item.key),
      );
      const { first, last } = extremesInWindow(matching.map((r) => r.analyzed_at));
      patterns.push({
        id: patternId("buying_signal", item.key),
        category: "buying_signal",
        description: `Sinal de compra "${item.key}" observado em ${item.count} conversas (${item.percentage}%).`,
        occurrences: item.count,
        confidence: confidenceFor(item.count, total),
        firstObserved: first,
        lastObserved: last,
        trend: computeTrend(rows, (r) =>
          (r.buying_signals_json ?? []).some((o) => String(o).toLowerCase() === item.key),
        ),
        evidence: {
          conversations: item.count,
          percentage: item.percentage,
          reference: `sample=${total}`,
        },
      });
    }

    // -------- Produtos --------------------------------------------------------
    for (const item of metrics.topProducts.slice(0, 5)) {
      patterns.push({
        id: patternId("product", item.key),
        category: "product",
        description: `Produto "${item.key}" citado em ${item.count} conversas (${item.percentage}%).`,
        occurrences: item.count,
        confidence: confidenceFor(item.count, total),
        firstObserved: null,
        lastObserved: null,
        trend: computeTrend(rows, (r) =>
          (r.products_json ?? []).some((o) => String(o).toLowerCase() === item.key),
        ),
        evidence: {
          conversations: item.count,
          percentage: item.percentage,
          reference: `sample=${total}`,
        },
      });
    }

    // -------- Canais ----------------------------------------------------------
    for (const ch of metrics.byChannel) {
      if (ch.conversations < 3) continue;
      const conv = ch.conversations;
      const conversionRate = conv > 0 ? Math.round((ch.sold / conv) * 1000) / 10 : 0;
      patterns.push({
        id: patternId("channel", ch.channel),
        category: "channel",
        description: `Canal "${ch.channel}" concentra ${conv} conversas com ${ch.sold} vendas (${conversionRate}%).`,
        occurrences: conv,
        confidence: confidenceFor(conv, total),
        firstObserved: null,
        lastObserved: null,
        trend: computeTrend(rows, (r) => (r.channel ?? "unknown").toLowerCase() === ch.channel),
        evidence: {
          conversations: conv,
          percentage: total > 0 ? Math.round((conv / total) * 1000) / 10 : 0,
          channel: ch.channel,
          reference: `sample=${total}`,
        },
      });
    }

    // -------- Abandono / Conversão / Timing -----------------------------------
    const abandoned = metrics.byLifecycle.abandoned ?? 0;
    if (abandoned > 0) {
      patterns.push({
        id: patternId("abandonment", "global"),
        category: "abandonment",
        description: `${abandoned} de ${total} conversas foram classificadas como abandonadas (${Math.round((abandoned / total) * 1000) / 10}%).`,
        occurrences: abandoned,
        confidence: confidenceFor(abandoned, total),
        firstObserved: null,
        lastObserved: null,
        trend: computeTrend(rows, (r) => r.lifecycle_status === "abandoned"),
        evidence: {
          conversations: abandoned,
          percentage: Math.round((abandoned / total) * 1000) / 10,
          reference: `sample=${total}`,
        },
      });
    }
    const sold = metrics.byLifecycle.sold ?? 0;
    if (sold > 0) {
      patterns.push({
        id: patternId("conversion", "global"),
        category: "conversion",
        description: `${sold} de ${total} conversas resultaram em venda (${Math.round((sold / total) * 1000) / 10}%).`,
        occurrences: sold,
        confidence: confidenceFor(sold, total),
        firstObserved: null,
        lastObserved: null,
        trend: computeTrend(rows, (r) => r.lifecycle_status === "sold"),
        evidence: {
          conversations: sold,
          percentage: Math.round((sold / total) * 1000) / 10,
          reference: `sample=${total}`,
        },
      });
    }
    if (metrics.timing.avgFirstResponseMinutes !== null) {
      patterns.push({
        id: patternId("timing", "first-response"),
        category: "timing",
        description: `Tempo médio de primeira resposta observado: ${metrics.timing.avgFirstResponseMinutes} minutos.`,
        occurrences: rows.filter((r) => typeof r.first_response_minutes === "number").length,
        confidence: confidenceFor(
          rows.filter((r) => typeof r.first_response_minutes === "number").length,
          total,
        ),
        firstObserved: null,
        lastObserved: null,
        trend: "stable",
        evidence: {
          avgMinutes: metrics.timing.avgFirstResponseMinutes,
          reference: `sample=${total}`,
        },
      });
    }

    return patterns;
  }
}
