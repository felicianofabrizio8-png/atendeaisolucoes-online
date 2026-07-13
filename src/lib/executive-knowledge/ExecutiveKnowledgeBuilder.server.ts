// ============================================================================
// ExecutiveKnowledgeBuilder — Transforma um Executive Snapshot em um registro
// de conhecimento agregado (facts / highlights / recommendations).
// 100% determinístico. Não consulta banco. Não usa LLM. Não recebe PII.
// ============================================================================

import type { ExecutiveDashboardBundle } from "@/lib/executive-ai/types";
import {
  KNOWLEDGE_VERSION,
  type KnowledgeFacts,
  type KnowledgeHighlight,
  type KnowledgeRecommendation,
} from "./ExecutiveKnowledgeTypes";

export interface BuiltKnowledge {
  knowledgeVersion: number;
  facts: KnowledgeFacts;
  highlights: KnowledgeHighlight[];
  recommendations: KnowledgeRecommendation[];
}

function pct(n: number, base: number): number {
  if (!Number.isFinite(base) || base <= 0) return 0;
  return Math.round((n / base) * 1000) / 10;
}

export class ExecutiveKnowledgeBuilder {
  static build(bundle: ExecutiveDashboardBundle): BuiltKnowledge {
    const m = bundle.metrics;

    const facts: KnowledgeFacts = {
      period: bundle.period,
      rangeDays: bundle.range.days,
      attendance: {
        newLeads: m.attendance.newLeads,
        attendedLeads: m.attendance.attendedLeads,
        unansweredLeads: m.attendance.unansweredLeads,
        avgResponseMinutes: m.attendance.avgResponseMinutes,
        conversionRate: m.attendance.conversionRate,
      },
      sales: {
        quotesIssued: m.sales.quotesIssued,
        estimatedSales: m.sales.estimatedSales,
        averageTicket: m.sales.averageTicket,
        closedCount: m.sales.closedCount,
        lostCount: m.sales.lostCount,
      },
      campaigns: {
        avgCostPerLead: m.campaigns.avgCostPerLead,
        avgCostPerConversation: m.campaigns.avgCostPerConversation,
        bestCount: m.campaigns.best.length,
        worstCount: m.campaigns.worst.length,
      },
      followups: {
        pending: m.followups.pending,
        completed: m.followups.completed,
        cancelled: m.followups.cancelled,
      },
      coach: {
        openAlerts: m.coach.openAlerts,
        criticalAlerts: m.coach.criticalAlerts,
      },
      aiUsage: {
        autoReplies: m.aiUsage.autoReplies,
        handoffs: m.aiUsage.handoffs,
        qualifications: m.aiUsage.qualifications,
        timeSavedMinutes: m.aiUsage.timeSavedMinutes,
      },
      dataQuality: {
        tablesEmpty: bundle.dataQuality.tablesEmpty,
        unavailable: bundle.dataQuality.unavailableMetrics.map((u) => u.metric),
        estimated: bundle.dataQuality.estimatedMetrics.map((e) => e.metric),
        warnings: bundle.dataQuality.warnings,
      },
    };

    const highlights: KnowledgeHighlight[] = [];

    if (facts.attendance.newLeads > 0) {
      const unansweredPct = pct(facts.attendance.unansweredLeads, facts.attendance.newLeads);
      if (unansweredPct >= 30) {
        highlights.push({
          key: "attendance.unanswered_high",
          level: "critical",
          title: "Muitos leads sem resposta",
          detail: `${facts.attendance.unansweredLeads} de ${facts.attendance.newLeads} leads não foram atendidos (${unansweredPct}%).`,
        });
      } else if (unansweredPct >= 10) {
        highlights.push({
          key: "attendance.unanswered_medium",
          level: "warn",
          title: "Leads sem resposta acima do ideal",
          detail: `${unansweredPct}% dos leads novos ainda não receberam retorno.`,
        });
      }
      if (facts.attendance.conversionRate >= 20) {
        highlights.push({
          key: "attendance.conversion_good",
          level: "good",
          title: "Conversão saudável",
          detail: `Taxa de conversão de ${facts.attendance.conversionRate}% no período.`,
        });
      } else if (facts.attendance.conversionRate > 0 && facts.attendance.conversionRate < 5) {
        highlights.push({
          key: "attendance.conversion_low",
          level: "warn",
          title: "Conversão baixa",
          detail: `Taxa de conversão de apenas ${facts.attendance.conversionRate}%.`,
        });
      }
    }

    if (facts.attendance.avgResponseMinutes > 30) {
      highlights.push({
        key: "attendance.response_slow",
        level: "warn",
        title: "Tempo de resposta elevado",
        detail: `Média de ${facts.attendance.avgResponseMinutes} min para o primeiro retorno (estimado).`,
      });
    }

    if (facts.sales.closedCount > 0) {
      highlights.push({
        key: "sales.closed",
        level: "good",
        title: "Vendas fechadas no período",
        detail: `${facts.sales.closedCount} vendas fechadas, ticket médio estimado em R$ ${facts.sales.averageTicket.toFixed(2)}.`,
      });
    }

    if (facts.coach.criticalAlerts > 0) {
      highlights.push({
        key: "coach.critical",
        level: "critical",
        title: "Alertas críticos do Coach",
        detail: `${facts.coach.criticalAlerts} alertas críticos abertos precisam de atenção.`,
      });
    }

    if (facts.followups.pending > 20) {
      highlights.push({
        key: "followups.backlog",
        level: "warn",
        title: "Fila de follow-ups acumulada",
        detail: `${facts.followups.pending} follow-ups pendentes.`,
      });
    }

    if (facts.aiUsage.timeSavedMinutes >= 60) {
      const hours = Math.round(facts.aiUsage.timeSavedMinutes / 60);
      highlights.push({
        key: "ai.time_saved",
        level: "good",
        title: "Ganho de produtividade com IA",
        detail: `≈ ${hours}h economizadas com auto-respostas (estimado).`,
      });
    }

    // Recomendações derivadas dos insights já produzidos pelo Executive Intelligence.
    const recommendations: KnowledgeRecommendation[] = bundle.insights
      .filter((i) => i.recommendation && i.recommendation.trim().length > 0)
      .slice(0, 8)
      .map((i, idx) => ({
        key: `${i.category}.${idx}`,
        priority: i.level === "critical" ? "high" : i.level === "warn" ? "medium" : "low",
        text: i.recommendation as string,
      }));

    return {
      knowledgeVersion: KNOWLEDGE_VERSION,
      facts,
      highlights,
      recommendations,
    };
  }
}
