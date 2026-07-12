// ============================================================================
// ExecutiveInsights — Geração de insights estratégicos.
// READ-ONLY. Cada insight declara confidence + evidence (métricas de origem).
//
// Regras aplicadas nesta versão:
//  - Orçamento (quote) NUNCA é tratado como venda. "Venda" = lead.status='fechado'.
//  - Campanhas só entram no "melhor/pior" com volume mínimo (spend>=50 OU leads>=5).
//  - Métricas indisponíveis (topProducts.sold/revenue) não geram recomendação.
//  - Comparações relativas evitam divisão por zero; sem base anterior => low.
//  - Zero real (ex.: 0 vendas com 0 leads) NÃO gera insight negativo.
// ============================================================================

import type { RawExecutiveDataset } from "./ExecutiveAnalyzer.server";
import type {
  ExecutiveInsight,
  ExecutiveMetricsBundle,
  InsightConfidence,
  InsightEvidence,
} from "./types";

type NewInsight = Omit<ExecutiveInsight, "confidence" | "evidence"> & {
  confidence: InsightConfidence;
  evidence: InsightEvidence;
};

export class ExecutiveInsights {
  constructor(
    private readonly metrics: ExecutiveMetricsBundle,
    private readonly dataset: RawExecutiveDataset,
  ) {}

  build(): ExecutiveInsight[] {
    const out: NewInsight[] = [];
    const m = this.metrics;

    // ---- Bottlenecks ----
    if (m.attendance.unansweredLeads > 0 && m.attendance.newLeads >= 5) {
      out.push({
        id: "bottleneck-unanswered",
        category: "bottleneck",
        level: m.attendance.unansweredLeads > 10 ? "critical" : "warn",
        title: "Leads sem resposta",
        description: `${m.attendance.unansweredLeads} leads não receberam resposta no período.`,
        recommendation: "Ative o Modo Operador ou revise a distribuição de conversas na Caixa.",
        metricRef: "attendance.unansweredLeads",
        confidence: "medium",
        evidence: {
          metrics: ["attendance.newLeads", "attendance.attendedLeads"],
          reason:
            "Diferença entre leads criados e leads com pelo menos uma mensagem role='agent' (inclui IA).",
        },
      });
    }
    if (m.attendance.avgResponseMinutes > 30 && m.attendance.attendedLeads >= 5) {
      out.push({
        id: "bottleneck-response-time",
        category: "bottleneck",
        level: m.attendance.avgResponseMinutes > 120 ? "critical" : "warn",
        title: "Tempo de resposta elevado",
        description: `Média de ${m.attendance.avgResponseMinutes} min até o primeiro atendimento.`,
        recommendation: "Considere aumentar a autonomia da IA de Atendimento.",
        metricRef: "attendance.avgResponseMinutes",
        confidence: "medium",
        evidence: {
          metrics: ["messages.at", "messages.role"],
          reason:
            "Δ entre 1ª msg do lead e 1ª msg role='agent' posterior; inclui auto-respostas da IA.",
        },
      });
    }

    // ---- Oportunidades comerciais ----
    // Orçamentos abertos ≠ venda. Só reporta quando há volume relevante.
    if (m.sales.quotesIssued >= 5 && m.sales.closedCount === 0) {
      out.push({
        id: "opportunity-quotes-open",
        category: "opportunity",
        level: "warn",
        title: "Orçamentos emitidos sem fechamento",
        description: `${m.sales.quotesIssued} orçamentos no período e 0 leads marcados como 'fechado'.`,
        recommendation:
          "Verifique se a equipe está usando a ação 'Fechar venda' na Caixa — sem isso não há registro de venda.",
        confidence: "high",
        evidence: {
          metrics: ["sales.quotesIssued", "sales.closedCount"],
          reason: "Contagem direta de quotes vs leads com status='fechado'.",
        },
      });
    }
    // Taxa de conversão só faz sentido com base mínima.
    if (m.attendance.newLeads >= 10 && m.sales.closedCount > 0) {
      out.push({
        id: "opportunity-conversion",
        category: "opportunity",
        level: m.attendance.conversionRate >= 15 ? "good" : "info",
        title: `Taxa de conversão: ${m.attendance.conversionRate}%`,
        description: `${m.sales.closedCount}/${m.attendance.newLeads} leads fechados.`,
        confidence: "high",
        evidence: {
          metrics: ["sales.closedCount", "attendance.newLeads"],
          reason: "leads(status='fechado') / leads criados no período.",
        },
      });
    }

    // ---- Campanhas (gate de volume mínimo) ----
    const bestC = m.campaigns.best.find((c) => c.leads >= 5 || c.spend >= 50);
    if (bestC) {
      out.push({
        id: `campaign-best-${bestC.id}`,
        category: "campaign",
        level: "good",
        title: `Campanha em destaque: ${bestC.name}`,
        description: `${bestC.leads} leads · custo médio R$ ${bestC.costPerLead.toFixed(2)}.`,
        recommendation: "Considere aumentar o orçamento — avalie CAC vs ticket antes de escalar.",
        confidence: bestC.leads >= 20 ? "high" : "medium",
        evidence: {
          metrics: ["campaigns.best[].leads", "campaigns.best[].spend"],
          reason: "Ranking por score = leads / (spend + 1) filtrado por volume mínimo.",
        },
      });
    }
    const worstC = m.campaigns.worst.find((c) => c.spend >= 50 && c.leads <= 1);
    if (worstC) {
      out.push({
        id: `campaign-worst-${worstC.id}`,
        category: "campaign",
        level: "warn",
        title: `Campanha com baixo desempenho: ${worstC.name}`,
        description: `R$ ${worstC.spend.toFixed(2)} investidos com ${worstC.leads} leads.`,
        recommendation: "Avalie pausar ou revisar segmentação/criativo.",
        confidence: "medium",
        evidence: {
          metrics: ["campaigns.worst[].spend", "campaigns.worst[].leads"],
          reason: "Gasto ≥ R$50 com ≤ 1 lead atribuído.",
        },
      });
    }

    // ---- Clientes esquecidos ----
    const forgotten = this.forgottenLeads();
    if (forgotten > 0) {
      out.push({
        id: "forgotten-clients",
        category: "forgotten_client",
        level: forgotten > 20 ? "warn" : "info",
        title: "Clientes sem contato há mais de 7 dias",
        description: `${forgotten} leads ativos sem contato recente.`,
        recommendation: "Dispare um follow-up ou template de reengajamento.",
        confidence: "medium",
        evidence: {
          metrics: ["leads.last_contact_at", "leads.status"],
          reason:
            "Leads não-fechados/perdidos com last_contact_at (fallback updated_at) < hoje-7d.",
        },
      });
    }

    // ---- Follow-ups ----
    if (m.followups.pending > 0) {
      out.push({
        id: "ops-followups",
        category: "operational",
        level: m.followups.pending > 20 ? "warn" : "info",
        title: "Follow-ups pendentes",
        description: `${m.followups.pending} follow-ups aguardando execução.`,
        confidence: "high",
        evidence: {
          metrics: ["follow_ups.status"],
          reason: "status ∈ {pending, scheduled, queued}.",
        },
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
        confidence: "high",
        evidence: {
          metrics: ["coach_alerts.severity", "coach_alerts.status"],
          reason: "severity='critical' AND status='open'.",
        },
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
        )}h economizadas (estimativa).`,
        confidence: "low",
        evidence: {
          metrics: ["ai_flow_events.event_type='auto_reply_sent'"],
          reason: "Heurística: 3 min por auto-resposta.",
        },
      });
    }

    // ---- Perdas ----
    if (m.lossReasons[0] && m.sales.lostCount >= 3) {
      out.push({
        id: "loss-top",
        category: "commercial",
        level: "info",
        title: `Principal motivo de perda: ${m.lossReasons[0].reason}`,
        description: `${m.lossReasons[0].count} leads perdidos por esse motivo.`,
        recommendation: "Treine a IA e a equipe para contornar essa objeção.",
        confidence: m.sales.lostCount >= 10 ? "medium" : "low",
        evidence: {
          metrics: ["leads.loss_reason", "leads.status='perdido'"],
          reason: "Agregação de loss_reason em leads perdidos no período.",
        },
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
