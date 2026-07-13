// ============================================================================
// ExecutiveKnowledgeComparer — Compara dois registros de conhecimento.
// Determinístico, sem LLM, sem banco. Produz deltas, novos fatos, melhoras,
// quedas e um resumo textual usado pela Narrative como memória de longo prazo.
// ============================================================================

import type {
  ExecutiveKnowledgeRecord,
  KnowledgeComparison,
  KnowledgeDelta,
  KnowledgeFacts,
} from "./ExecutiveKnowledgeTypes";

type MetricDef = {
  key: string;
  label: string;
  get: (f: KnowledgeFacts) => number;
  higherIsBetter: boolean;
};

const METRICS: MetricDef[] = [
  { key: "newLeads", label: "Leads novos", get: (f) => f.attendance.newLeads, higherIsBetter: true },
  { key: "attendedLeads", label: "Leads atendidos", get: (f) => f.attendance.attendedLeads, higherIsBetter: true },
  { key: "unansweredLeads", label: "Leads sem resposta", get: (f) => f.attendance.unansweredLeads, higherIsBetter: false },
  { key: "avgResponseMinutes", label: "Tempo médio de resposta (min)", get: (f) => f.attendance.avgResponseMinutes, higherIsBetter: false },
  { key: "conversionRate", label: "Taxa de conversão (%)", get: (f) => f.attendance.conversionRate, higherIsBetter: true },
  { key: "quotesIssued", label: "Orçamentos emitidos", get: (f) => f.sales.quotesIssued, higherIsBetter: true },
  { key: "closedCount", label: "Vendas fechadas", get: (f) => f.sales.closedCount, higherIsBetter: true },
  { key: "lostCount", label: "Vendas perdidas", get: (f) => f.sales.lostCount, higherIsBetter: false },
  { key: "estimatedSales", label: "Vendas estimadas (R$)", get: (f) => f.sales.estimatedSales, higherIsBetter: true },
  { key: "averageTicket", label: "Ticket médio (R$)", get: (f) => f.sales.averageTicket, higherIsBetter: true },
  { key: "avgCostPerLead", label: "Custo médio por lead", get: (f) => f.campaigns.avgCostPerLead, higherIsBetter: false },
  { key: "avgCostPerConversation", label: "Custo médio por conversa", get: (f) => f.campaigns.avgCostPerConversation, higherIsBetter: false },
  { key: "pendingFollowups", label: "Follow-ups pendentes", get: (f) => f.followups.pending, higherIsBetter: false },
  { key: "openAlerts", label: "Alertas abertos", get: (f) => f.coach.openAlerts, higherIsBetter: false },
  { key: "criticalAlerts", label: "Alertas críticos", get: (f) => f.coach.criticalAlerts, higherIsBetter: false },
  { key: "timeSavedMinutes", label: "Tempo economizado por IA (min)", get: (f) => f.aiUsage.timeSavedMinutes, higherIsBetter: true },
];

function daysBetween(from: string, to: string): number | null {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

function classify(prev: number, curr: number, higherIsBetter: boolean): KnowledgeDelta {
  const abs = Math.round((curr - prev) * 100) / 100;
  const pct =
    prev === 0
      ? curr === 0
        ? 0
        : null
      : Math.round(((curr - prev) / Math.abs(prev)) * 1000) / 10;

  let direction: KnowledgeDelta["direction"] = "flat";
  if (abs > 0) direction = "up";
  else if (abs < 0) direction = "down";

  let trend: KnowledgeDelta["trend"] = "neutral";
  if (direction === "up") trend = higherIsBetter ? "improved" : "worsened";
  else if (direction === "down") trend = higherIsBetter ? "worsened" : "improved";

  return { metric: "", label: "", previous: prev, current: curr, absoluteDelta: abs, percentDelta: pct, direction, trend };
}

export class ExecutiveKnowledgeComparer {
  static compare(
    current: ExecutiveKnowledgeRecord,
    previous: ExecutiveKnowledgeRecord | null,
  ): KnowledgeComparison {
    if (!previous) {
      return {
        previousSnapshotAt: null,
        currentSnapshotAt: current.snapshotGeneratedAt,
        daysBetween: null,
        deltas: [],
        newFacts: ["Primeiro snapshot registrado — ainda não há histórico para comparação."],
        improvements: [],
        regressions: [],
        summary: "Sem comparação disponível: este é o primeiro registro de conhecimento.",
      };
    }

    const deltas: KnowledgeDelta[] = METRICS.map((m) => {
      const d = classify(m.get(previous.facts), m.get(current.facts), m.higherIsBetter);
      return { ...d, metric: m.key, label: m.label };
    });

    const improvements = deltas
      .filter((d) => d.trend === "improved" && d.absoluteDelta !== 0)
      .sort((a, b) => Math.abs((b.percentDelta ?? 0)) - Math.abs((a.percentDelta ?? 0)))
      .slice(0, 5)
      .map((d) => `${d.label}: ${formatChange(d)}`);

    const regressions = deltas
      .filter((d) => d.trend === "worsened" && d.absoluteDelta !== 0)
      .sort((a, b) => Math.abs((b.percentDelta ?? 0)) - Math.abs((a.percentDelta ?? 0)))
      .slice(0, 5)
      .map((d) => `${d.label}: ${formatChange(d)}`);

    const newFacts: string[] = [];
    if (previous.facts.sales.closedCount === 0 && current.facts.sales.closedCount > 0) {
      newFacts.push(`Voltou a fechar vendas no período (${current.facts.sales.closedCount}).`);
    }
    if (previous.facts.coach.criticalAlerts === 0 && current.facts.coach.criticalAlerts > 0) {
      newFacts.push(`Surgiram ${current.facts.coach.criticalAlerts} alertas críticos.`);
    }
    if (previous.facts.attendance.newLeads === 0 && current.facts.attendance.newLeads > 0) {
      newFacts.push(`Voltou a receber leads novos (${current.facts.attendance.newLeads}).`);
    }

    const dBetween = daysBetween(previous.snapshotGeneratedAt, current.snapshotGeneratedAt);
    const summary =
      improvements.length === 0 && regressions.length === 0
        ? "Cenário estável em relação ao último snapshot."
        : `Comparado ao snapshot anterior (${dBetween ?? "?"} dias atrás): ${improvements.length} melhora(s), ${regressions.length} piora(s).`;

    return {
      previousSnapshotAt: previous.snapshotGeneratedAt,
      currentSnapshotAt: current.snapshotGeneratedAt,
      daysBetween: dBetween,
      deltas,
      newFacts,
      improvements,
      regressions,
      summary,
    };
  }
}

function formatChange(d: KnowledgeDelta): string {
  const sign = d.absoluteDelta > 0 ? "+" : "";
  const pct = d.percentDelta === null ? "" : ` (${d.percentDelta > 0 ? "+" : ""}${d.percentDelta}%)`;
  return `${sign}${d.absoluteDelta}${pct}`;
}
