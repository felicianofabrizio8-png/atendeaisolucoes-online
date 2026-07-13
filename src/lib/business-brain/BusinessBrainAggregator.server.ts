// ============================================================================
// BusinessBrainAggregator — Determinístico. Transforma facts crus em métricas
// agregadas. Não gera texto interpretativo, não chama LLM. Sem PII.
// ============================================================================

import type {
  BrainMetrics,
  ChannelBreakdown,
  EvolutionBucket,
  EvolutionSeries,
  FrequencyItem,
  TimingMetrics,
} from "./BusinessBrainTypes";
import type { RawFactRow } from "./BusinessBrainAnalyzer.server";

function tally(rows: RawFactRow[], pick: (r: RawFactRow) => string[] | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const list = pick(r) ?? [];
    for (const raw of list) {
      const key = String(raw ?? "").trim().toLowerCase();
      if (!key) continue;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
  }
  return m;
}

function topN(map: Map<string, number>, denom: number, n = 10): FrequencyItem[] {
  const total = denom > 0 ? denom : 0;
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({
      key,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }));
}

function avg(nums: number[]): number | null {
  const clean = nums.filter((n) => Number.isFinite(n));
  if (clean.length === 0) return null;
  const sum = clean.reduce((a, b) => a + b, 0);
  return Math.round((sum / clean.length) * 10) / 10;
}

function isoWeek(d: Date): string {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400_000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildEvolution(rows: RawFactRow[]): EvolutionSeries {
  const weekly = new Map<string, EvolutionBucket>();
  const monthly = new Map<string, EvolutionBucket>();

  for (const r of rows) {
    const src = r.last_message_at ?? r.analyzed_at;
    if (!src) continue;
    const d = new Date(src);
    if (Number.isNaN(d.getTime())) continue;

    const wKey = isoWeek(d);
    const mKey = monthKey(d);
    const w = weekly.get(wKey) ?? { bucket: wKey, conversations: 0, sold: 0, lost: 0 };
    const m = monthly.get(mKey) ?? { bucket: mKey, conversations: 0, sold: 0, lost: 0 };
    w.conversations += 1;
    m.conversations += 1;
    if (r.lifecycle_status === "sold") {
      w.sold += 1;
      m.sold += 1;
    } else if (r.lifecycle_status === "lost") {
      w.lost += 1;
      m.lost += 1;
    }
    weekly.set(wKey, w);
    monthly.set(mKey, m);
  }

  const sort = (a: EvolutionBucket, b: EvolutionBucket) => (a.bucket < b.bucket ? -1 : 1);
  return {
    weekly: Array.from(weekly.values()).sort(sort),
    monthly: Array.from(monthly.values()).sort(sort),
  };
}

function buildChannels(rows: RawFactRow[]): ChannelBreakdown[] {
  const map = new Map<string, ChannelBreakdown & { _confSum: number; _confN: number }>();
  for (const r of rows) {
    const channel = (r.channel ?? "unknown").trim().toLowerCase() || "unknown";
    const row = map.get(channel) ?? {
      channel,
      conversations: 0,
      sold: 0,
      lost: 0,
      abandoned: 0,
      inProgress: 0,
      avgConfidence: 0,
      _confSum: 0,
      _confN: 0,
    };
    row.conversations += 1;
    if (r.lifecycle_status === "sold") row.sold += 1;
    else if (r.lifecycle_status === "lost") row.lost += 1;
    else if (r.lifecycle_status === "abandoned") row.abandoned += 1;
    else if (r.lifecycle_status === "in_progress") row.inProgress += 1;
    if (typeof r.confidence === "number" && Number.isFinite(r.confidence)) {
      row._confSum += r.confidence;
      row._confN += 1;
    }
    map.set(channel, row);
  }
  return Array.from(map.values())
    .map((r) => ({
      channel: r.channel,
      conversations: r.conversations,
      sold: r.sold,
      lost: r.lost,
      abandoned: r.abandoned,
      inProgress: r.inProgress,
      avgConfidence: r._confN > 0 ? Math.round((r._confSum / r._confN) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.conversations - a.conversations);
}

function buildTiming(rows: RawFactRow[]): TimingMetrics {
  const responses: number[] = [];
  const sale: number[] = [];
  const loss: number[] = [];
  const abandon: number[] = [];
  for (const r of rows) {
    if (typeof r.first_response_minutes === "number") responses.push(r.first_response_minutes);
    if (typeof r.negotiation_duration_minutes === "number") {
      if (r.lifecycle_status === "sold") sale.push(r.negotiation_duration_minutes);
      else if (r.lifecycle_status === "lost") loss.push(r.negotiation_duration_minutes);
      else if (r.lifecycle_status === "abandoned") abandon.push(r.negotiation_duration_minutes);
    }
  }
  return {
    avgFirstResponseMinutes: avg(responses),
    avgNegotiationMinutesToSale: avg(sale),
    avgNegotiationMinutesToLoss: avg(loss),
    avgNegotiationMinutesToAbandon: avg(abandon),
  };
}

export class BusinessBrainAggregator {
  static build(rows: RawFactRow[]): BrainMetrics {
    const total = rows.length;

    const byLifecycle: Record<string, number> = {};
    for (const r of rows) {
      const k = r.lifecycle_status ?? "unknown";
      byLifecycle[k] = (byLifecycle[k] ?? 0) + 1;
    }

    const sentimentDistribution: Record<string, number> = {};
    for (const r of rows) {
      const k = r.sentiment_label ?? "unknown";
      sentimentDistribution[k] = (sentimentDistribution[k] ?? 0) + 1;
    }

    return {
      totalConversationsAnalyzed: total,
      byLifecycle,
      byChannel: buildChannels(rows),
      topObjections: topN(tally(rows, (r) => r.objections_json), total),
      topBuyingSignals: topN(tally(rows, (r) => r.buying_signals_json), total),
      topNegativeSignals: topN(tally(rows, (r) => r.negative_signals_json), total),
      topProducts: topN(tally(rows, (r) => r.products_json), total),
      topIntents: topN(
        tally(rows, (r) => (r.primary_intent ? [r.primary_intent] : r.intents_json)),
        total,
      ),
      topTopics: topN(tally(rows, (r) => r.topics_json), total),
      sentimentDistribution,
      timing: buildTiming(rows),
      evolution: buildEvolution(rows),
    };
  }
}
