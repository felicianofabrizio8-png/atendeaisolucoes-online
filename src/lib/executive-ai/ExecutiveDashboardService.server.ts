// ============================================================================
// ExecutiveDashboardService — Fachada READ-ONLY do Executive Intelligence.
// Orquestra Analyzer + Metrics + Insights e produz um bundle único
// acompanhado de um relatório de qualidade dos dados (dataQuality).
// ============================================================================

import {
  ExecutiveAnalyzer,
  resolveRange,
  type RawExecutiveDataset,
} from "./ExecutiveAnalyzer.server";
import { ExecutiveMetrics } from "./ExecutiveMetrics.server";
import { ExecutiveInsights } from "./ExecutiveInsights.server";
import type {
  DataQualityReport,
  ExecutiveDashboardBundle,
  ExecutivePeriod,
  ExecutiveRange,
} from "./types";

const TABLES_QUERIED = [
  "leads",
  "conversations",
  "messages",
  "follow_ups",
  "quotes",
  "products",
  "campaigns",
  "campaign_metrics",
  "campaign_ai_analyses",
  "coach_alerts",
  "ai_flow_events",
  "audit_log",
  "company_settings",
] as const;

export function buildDataQuality(
  dataset: RawExecutiveDataset,
  period: ExecutivePeriod,
  range: ExecutiveRange,
): DataQualityReport {
  const counts: Record<string, number> = {
    leads: dataset.newLeadsData.length,
    closed_sales: dataset.closedSalesData.length,
    lost_leads: dataset.lostLeadsData.length,
    closed_sales_without_closed_at: dataset.closedSalesWithoutClosedAtData.length,
    lost_leads_without_lost_at: dataset.lostLeadsWithoutLostAtData.length,
    conversations: dataset.conversations.length,
    messages: dataset.messages.length,
    follow_ups: dataset.followUps.length,
    quotes: dataset.quotes.length,
    products: dataset.products.length,
    campaigns: dataset.campaigns.length,
    campaign_metrics: dataset.campaignMetrics.length,
    campaign_ai_analyses: dataset.campaignAnalyses.length,
    coach_alerts: dataset.coachAlerts.length,
    ai_flow_events: dataset.aiFlowEvents.length,
    audit_log: dataset.auditLog.length,
    company_settings: dataset.companySettings ? 1 : 0,
  };
  const tablesEmpty = Object.entries(counts)
    .filter(([, n]) => n === 0)
    .map(([t]) => t);

  const unavailable: DataQualityReport["unavailableMetrics"] = [];
  const estimated: DataQualityReport["estimatedMetrics"] = [];
  const warnings: string[] = [];

  if (dataset.products.length > 0) {
    unavailable.push({
      metric: "topProducts.soldCount / revenue",
      reason:
        "Não existe join direto entre quote_items e leads fechados neste módulo. Apenas o catálogo é exibido.",
    });
  }
  if (dataset.messages.length > 0) {
    estimated.push({
      metric: "attendance.attendedLeads",
      note: "Considera qualquer mensagem com role='agent' (inclui respostas automáticas da IA). Não é possível distinguir humano vs IA sem flag por mensagem.",
    });
    estimated.push({
      metric: "attendance.avgResponseMinutes",
      note: "Calculado como diferença entre 1ª msg do lead e 1ª msg role='agent' posterior; inclui auto-respostas da IA.",
    });
  }
  if (dataset.aiFlowEvents.length > 0) {
    estimated.push({
      metric: "aiUsage.timeSavedMinutes",
      note: "Heurística: 3 min por auto-resposta enviada.",
    });
  }
  if (dataset.campaignMetrics.length === 0 && dataset.campaigns.length > 0) {
    warnings.push(
      "campaign_metrics vazio no período — custos por lead/conversa usam fallback de leads_count/messages_count da tabela campaigns.",
    );
  }
  if (dataset.leads.length >= 5000) {
    warnings.push("Consulta de leads novos atingiu o limite de 5000 registros no período.");
  }
  if (dataset.closedSalesData.length >= 5000) {
    warnings.push("Consulta de vendas fechadas atingiu o limite de 5000 registros no período.");
  }
  if (dataset.closedSalesWithoutClosedAtData.length > 0) {
    warnings.push(
      "Existe venda marcada como fechada sem closed_at. Ela não pode ser incluída com segurança em um período específico.",
    );
  }
  if (dataset.lostLeadsWithoutLostAtData.length > 0) {
    unavailable.push({
      metric: "sales.lostCount / lossReasons para perdas sem lost_at",
      reason:
        "Existem leads marcados como perdidos sem lost_at; não há data confiável para atribuí-los a um período específico.",
    });
  }
  if (dataset.messages.length >= 10000) {
    warnings.push("Consulta de messages atingiu o limite de 10000 registros no período.");
  }

  return {
    tablesQueried: [...TABLES_QUERIED],
    tablesEmpty,
    tableRowCounts: counts,
    unavailableMetrics: unavailable,
    estimatedMetrics: estimated,
    warnings,
    period,
    range,
    timezone: "UTC",
    generatedAt: new Date().toISOString(),
  };
}

export class ExecutiveDashboardService {
  static async build(
    supabase: import("@supabase/supabase-js").SupabaseClient<
      import("@/integrations/supabase/types").Database
    >,
    companyId: string,
    period: ExecutivePeriod = "30d",
  ): Promise<ExecutiveDashboardBundle> {
    const range = resolveRange(period);
    const analyzer = new ExecutiveAnalyzer(supabase, companyId, range);
    const dataset = await analyzer.load();
    const metrics = new ExecutiveMetrics(dataset, range).compute();
    const insights = new ExecutiveInsights(metrics, dataset).build();
    const dataQuality = buildDataQuality(dataset, period, range);
    return {
      range,
      period,
      metrics,
      insights,
      dataQuality,
      generatedAt: new Date().toISOString(),
    };
  }
}
