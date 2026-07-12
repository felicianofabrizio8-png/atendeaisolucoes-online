// ============================================================================
// ExecutiveInsights — Geração de insights estratégicos.
// READ-ONLY: apenas leitura das métricas já calculadas + dataset.
// ============================================================================

import type { RawExecutiveDataset } from "./ExecutiveAnalyzer.server";
import type {
  ExecutiveInsight,
  ExecutiveMetricsBundle,
} from "./types";

export class ExecutiveInsights {
  constructor(
    private readonly metrics: ExecutiveMetricsBundle,
    private readonly dataset: RawExecutiveDataset,
  ) {}

  build(): ExecutiveInsight[] {
    const out: ExecutiveInsight[] = [];
    const m = this.metrics;

    // ---- Bottlenecks ----
    if (m.attendance.unansweredLeads > 0) {
      out.push({
        id: "bottleneck-unanswered",
        category: "bottleneck",
        level: m.attendance.unansweredLeads > 10 ? "critical" : "warn",
        title: "Leads sem resposta",
        description: `${m.attendance.unansweredLeads} leads não receberam resposta no período.`,
        recommendation:
          "Ative o Modo Operador ou revise a distribuição de conversas na Caixa.",
        metricRef: "attendance.unansweredLeads",
      });
    }
    if (m.attendance.avgResponseMinutes > 30) {
      out.push({
        id: "bottleneck-response-time",
        category: "bottleneck",
        level: m.attendance.avgResponseMinutes > 120 ? "critical" : "warn",
        title: "Tempo de resposta elevado",
        description: `Média de ${m.attendance.avgResponseMinutes} min para o primeiro atendimento.`,
        recommendation: "Considere aumentar a autonomia da IA de Atendimento.",
        metricRef: "attendance.avgResponseMinutes",
      });
    }

    // ---- Oportunidades ----
    if (m.sales.quotesIssued > 0 && m.sales.closedCount === 0) {
      out.push({
        id: "opportunity-quotes-open",
        category: "opportunity",
        level: "info",
        title: "Orçamentos abertos",
        description: `${m.sales.quotesIssued} orçamentos emitidos sem fechamento no período.`,
        recommendation: "Programe follow-up ativo para essas oportunidades.",
      });
    }
    if (m.attendance.conversionRate > 0) {
      out.push({
        id: "opportunity-conversion",
        category: "opportunity",
        level: m.attendance.conversionRate > 15 ? "good" : "info",
        title: "Taxa de conversão",
        description: `Conversão atual: ${m.attendance.conversionRate}%.`,
      });
    }

    // ---- Campanhas ----
    if (m.campaigns.best[0]) {
      const c = m.campaigns.best[0];
      out.push({
        id: `campaign-best-${c.id}`,
        category: "campaign",
        level: "good",
        title: `Campanha em destaque: ${c.name}`,
        description: `${c.leads} leads gerados com custo médio de R$ ${c.costPerLead.toFixed(2)}.`,
        recommendation: "Considere aumentar o orçamento desta campanha.",
      });
    }
    if (m.campaigns.worst[0] && m.campaigns.worst[0].spend > 0) {
      const c = m.campaigns.worst[0];
      out.push({
        id: `campaign-worst-${c.id}`,
        category: "campaign",
        level: "warn",
        title: `Campanha com baixo desempenho: ${c.name}`,
        description: `R$ ${c.spend.toFixed(2)} investidos com ${c.leads} leads.`,
        recommendation: "Avalie pausar ou revisar segmentação/criativo.",
      });
    }

    // ---- Clientes esquecidos ----
    const forgotten = this.forgottenLeads();
    if (forgotten > 0) {
      out.push({
        id: "forgotten-clients",
        category: "forgotten_client",
        level: forgotten > 20 ? "warn" : "info",
        title: "Clientes esquecidos",
        description: `${forgotten} leads sem contato há mais de 7 dias.`,
        recommendation: "Dispare um follow-up ou template de reengajamento.",
      });
    }

    // ---- Produtos ----
    if (m.topProducts[0]) {
      out.push({
        id: "trending-product",
        category: "trending_product",
        level: "info",
        title: "Catálogo ativo",
        description: `${m.topProducts.length} produtos disponíveis para venda.`,
      });
    }

    // ---- Follow-ups ----
    if (m.followups.pending > 0) {
      out.push({
        id: "ops-followups",
        category: "operational",
        level: m.followups.pending > 20 ? "warn" : "info",
        title: "Follow-ups pendentes",
        description: `${m.followups.pending} follow-ups agendados aguardando execução.`,
      });
    }

    // ---- Coach ----
    if (m.coach.criticalAlerts > 0) {
      out.push({
        id: "coach-critical",
        category: "operational",
        level: "critical",
        title: "Alertas críticos do Coach IA",
        description: `${m.coach.criticalAlerts} alertas críticos abertos.`,
        recommendation: "Priorize essas conversas no Inbox.",
      });
    }

    // ---- IA ----
    if (m.aiUsage.autoReplies > 0) {
      out.push({
        id: "ai-savings",
        category: "commercial",
        level: "good",
        title: "IA economizando tempo",
        description: `${m.aiUsage.autoReplies} respostas automáticas ≈ ${Math.round(
          m.aiUsage.timeSavedMinutes / 60,
        )}h economizadas.`,
      });
    }

    // ---- Perdas ----
    if (m.lossReasons[0]) {
      out.push({
        id: "loss-top",
        category: "commercial",
        level: "info",
        title: `Principal motivo de perda: ${m.lossReasons[0].reason}`,
        description: `${m.lossReasons[0].count} leads perdidos por esse motivo.`,
        recommendation:
          "Treine a IA e a equipe para contornar essa objeção.",
      });
    }

    return out;
  }

  private forgottenLeads(): number {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return this.dataset.leads.filter((l) => {
      if (l.status === "fechado" || l.status === "perdido") return false;
      const last = l.last_contact_at ?? l.updated_at ?? l.created_at;
      if (!last) return false;
      return +new Date(last) < cutoff;
    }).length;
  }
}
