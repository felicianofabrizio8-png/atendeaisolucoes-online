// ============================================================================
// ExecutiveMetrics — Cálculo puro de métricas a partir do dataset bruto.
// READ-ONLY: recebe RawExecutiveDataset e produz ExecutiveMetricsBundle.
// Sem I/O, sem efeitos colaterais.
// ============================================================================

import type { RawExecutiveDataset } from "./ExecutiveAnalyzer.server";
import type {
  AIUsageMetrics,
  AttendanceMetrics,
  CampaignMetricsBundle,
  CampaignPerformance,
  CoachMetrics,
  EvolutionPoint,
  EvolutionSeries,
  ExecutiveMetricsBundle,
  ExecutiveRange,
  FollowupMetrics,
  LossReasonBreakdown,
  ProductPerformance,
  SalesMetrics,
} from "./types";

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function bucketISO(d: Date, kind: "daily" | "weekly" | "monthly"): string {
  if (kind === "daily") return d.toISOString().slice(0, 10);
  if (kind === "monthly") return d.toISOString().slice(0, 7);
  // weekly ISO
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((+tmp - +yearStart) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export class ExecutiveMetrics {
  constructor(
    private readonly dataset: RawExecutiveDataset,
    private readonly range: ExecutiveRange,
  ) {}

  compute(): ExecutiveMetricsBundle {
    return {
      range: this.range,
      attendance: this.attendance(),
      sales: this.sales(),
      campaigns: this.campaigns(),
      topProducts: this.products().top,
      worstProducts: this.products().worst,
      lossReasons: this.lossReasons(),
      followups: this.followups(),
      coach: this.coach(),
      aiUsage: this.aiUsage(),
      evolution: this.evolution(),
    };
  }

  private attendance(): AttendanceMetrics {
    const { leads, messages, conversations } = this.dataset;
    const newLeads = leads.length;

    // conversas com >=1 mensagem agent
    const agentConvIds = new Set(
      messages.filter((m) => m.role === "agent").map((m) => m.conversation_id),
    );
    const attendedLeadIds = new Set(
      conversations
        .filter((c) => agentConvIds.has(c.id) && c.lead_id)
        .map((c) => c.lead_id),
    );
    const attendedLeads = attendedLeadIds.size;
    const unansweredLeads = Math.max(0, newLeads - attendedLeads);

    // tempo médio de resposta (min): 1a msg lead -> 1a msg agent posterior
    const byConv = new Map<string, any[]>();
    for (const m of messages) {
      const arr = byConv.get(m.conversation_id) ?? [];
      arr.push(m);
      byConv.set(m.conversation_id, arr);
    }
    const diffs: number[] = [];
    for (const [, arr] of byConv) {
      const sorted = arr
        .map((m) => ({ ...m, _t: +new Date(m.at ?? m.created_at) }))
        .filter((m) => Number.isFinite(m._t))
        .sort((a, b) => a._t - b._t);
      const firstLead = sorted.find((m) => m.role === "lead");
      if (!firstLead) continue;
      const firstAgent = sorted.find(
        (m) => m.role === "agent" && m._t > firstLead._t,
      );
      if (!firstAgent) continue;
      diffs.push((firstAgent._t - firstLead._t) / 60_000);
    }
    const avgResponseMinutes =
      diffs.length > 0 ? diffs.reduce((s, n) => s + n, 0) / diffs.length : 0;

    const closed = leads.filter((l) => l.status === "fechado").length;
    const conversionRate = newLeads > 0 ? (closed / newLeads) * 100 : 0;

    // Segmentação humano vs IA por conversa, usando conversations.auto_reply_count
    // como proxy do nº de mensagens enviadas pela IA. Heurística documentada
    // em dataQuality.estimatedMetrics.
    const agentMsgsByConv = new Map<string, number>();
    for (const m of messages) {
      if (m.role !== "agent") continue;
      agentMsgsByConv.set(m.conversation_id, (agentMsgsByConv.get(m.conversation_id) ?? 0) + 1);
    }
    const humanLeadIds = new Set<string>();
    const aiLeadIds = new Set<string>();
    const mixedLeadIds = new Set<string>();
    for (const c of conversations) {
      if (!c.lead_id) continue;
      const agentCount = agentMsgsByConv.get(c.id) ?? 0;
      if (agentCount === 0) continue;
      const aiCount = toNumber(c.auto_reply_count);
      if (aiCount <= 0) humanLeadIds.add(c.lead_id);
      else if (aiCount >= agentCount) aiLeadIds.add(c.lead_id);
      else mixedLeadIds.add(c.lead_id);
    }
    // Um lead atendido em mais de uma conversa: prioriza "human" > "mixed" > "ai"
    for (const id of humanLeadIds) { aiLeadIds.delete(id); mixedLeadIds.delete(id); }
    for (const id of mixedLeadIds) { aiLeadIds.delete(id); }

    return {
      newLeads,
      attendedLeads,
      unansweredLeads,
      avgResponseMinutes: Math.round(avgResponseMinutes * 10) / 10,
      conversionRate: Math.round(conversionRate * 10) / 10,
      humanAttendedLeads: humanLeadIds.size,
      aiAttendedLeads: aiLeadIds.size,
      mixedAttendedLeads: mixedLeadIds.size,
    };
  }

  private sales(): SalesMetrics {
    const { leads, quotes } = this.dataset;
    const closed = leads.filter((l) => l.status === "fechado");
    const lost = leads.filter((l) => l.status === "perdido");
    const estimatedSales = closed.reduce(
      (s, l) => s + toNumber(l.closed_value ?? l.estimated_value),
      0,
    );
    const averageTicket =
      closed.length > 0 ? estimatedSales / closed.length : 0;
    return {
      quotesIssued: quotes.length,
      estimatedSales,
      averageTicket: Math.round(averageTicket * 100) / 100,
      closedCount: closed.length,
      lostCount: lost.length,
    };
  }

  private campaigns(): CampaignMetricsBundle {
    // Colunas reais em public.campaign_metrics: spent, leads, messages, impressions, clicks
    const { campaigns, campaignMetrics } = this.dataset;
    const metricsByCampaign = new Map<string, Record<string, number>>();
    for (const m of campaignMetrics) {
      const id = m.campaign_id;
      if (!id) continue;
      const cur = metricsByCampaign.get(id) ?? {
        spend: 0,
        leads: 0,
        impressions: 0,
        clicks: 0,
        conversations: 0,
      };
      cur.spend += toNumber(m.spent);
      cur.leads += toNumber(m.leads);
      cur.impressions += toNumber(m.impressions);
      cur.clicks += toNumber(m.clicks);
      cur.conversations += toNumber(m.messages);
      metricsByCampaign.set(id, cur);
    }

    const perf: CampaignPerformance[] = campaigns.map((c) => {
      const m = metricsByCampaign.get(c.id) ?? {
        spend: 0,
        leads: 0,
        impressions: 0,
        clicks: 0,
        conversations: 0,
      };
      // Preferimos os agregados do campaign_metrics; fallback: leads_count na tabela campaigns
      const leadsCount = m.leads || toNumber((c as any).leads_count);
      const spend = m.spend || toNumber((c as any).spent);
      const costPerLead = leadsCount > 0 ? spend / leadsCount : 0;
      const conv = m.conversations || toNumber((c as any).messages_count);
      const costPerConversation = conv > 0 ? spend / conv : 0;
      const ctr =
        m.impressions > 0 ? (m.clicks / m.impressions) * 100 : 0;
      // score simples: leads / (spend + 1)
      const score = leadsCount / (spend + 1);
      return {
        id: c.id,
        name: c.name ?? c.id,
        spend: Math.round(spend * 100) / 100,
        leads: leadsCount,
        costPerLead: Math.round(costPerLead * 100) / 100,
        costPerConversation: Math.round(costPerConversation * 100) / 100,
        ctr: Math.round(ctr * 100) / 100,
        score,
      };
    });

    const withActivity = perf.filter((p) => p.spend > 0 || p.leads > 0);
    const sorted = [...withActivity].sort((a, b) => b.score - a.score);
    const best = sorted.slice(0, 5);
    const worst = [...withActivity]
      .sort((a, b) => a.score - b.score)
      .slice(0, 5);

    const totalSpend = withActivity.reduce((s, p) => s + p.spend, 0);
    const totalLeads = withActivity.reduce((s, p) => s + p.leads, 0);
    const totalConvCost = withActivity.reduce(
      (s, p) => s + p.costPerConversation,
      0,
    );
    return {
      best,
      worst,
      avgCostPerLead: totalLeads > 0 ? Math.round((totalSpend / totalLeads) * 100) / 100 : 0,
      avgCostPerConversation:
        withActivity.length > 0
          ? Math.round((totalConvCost / withActivity.length) * 100) / 100
          : 0,
    };
  }

  private products(): { top: ProductPerformance[]; worst: ProductPerformance[] } {
    const { products, quotes } = this.dataset;
    // sem tabela de itens do orçamento acessível aqui — usamos heurística:
    // vendas estimadas por produto ficam vazias, mas expomos o catálogo mais recente.
    const catalog: ProductPerformance[] = products.map((p) => ({
      id: p.id,
      name: p.name,
      soldCount: 0,
      revenue: 0,
    }));
    // como não temos join direto, reportamos apenas os presentes no catálogo.
    // Um enriquecimento futuro pode ler quote_items.
    void quotes;
    return {
      top: catalog.slice(0, 5),
      worst: catalog.slice(-5).reverse(),
    };
  }

  private lossReasons(): LossReasonBreakdown[] {
    const { leads } = this.dataset;
    const map = new Map<string, { count: number; value: number }>();
    for (const l of leads.filter((x) => x.status === "perdido")) {
      const reason = l.loss_reason ?? "Não informado";
      const cur = map.get(reason) ?? { count: 0, value: 0 };
      cur.count += 1;
      cur.value += toNumber(l.estimated_value);
      map.set(reason, cur);
    }
    return [...map.entries()]
      .map(([reason, v]) => ({ reason, ...v }))
      .sort((a, b) => b.count - a.count);
  }

  private followups(): FollowupMetrics {
    const { followUps } = this.dataset;
    let pending = 0;
    let completed = 0;
    let cancelled = 0;
    for (const f of followUps) {
      const s = String(f.status ?? "").toLowerCase();
      if (s === "pending" || s === "scheduled" || s === "queued") pending++;
      else if (s === "sent" || s === "responded" || s === "completed") completed++;
      else if (s === "cancelled" || s === "canceled") cancelled++;
    }
    return { pending, completed, cancelled };
  }

  private coach(): CoachMetrics {
    const { coachAlerts } = this.dataset;
    const open = coachAlerts.filter((a) => a.status === "open");
    const bySeverity: Record<string, number> = {};
    for (const a of open) {
      const s = String(a.severity ?? "low");
      bySeverity[s] = (bySeverity[s] ?? 0) + 1;
    }
    return {
      openAlerts: open.length,
      criticalAlerts: open.filter((a) => a.severity === "critical").length,
      bySeverity,
    };
  }

  private aiUsage(): AIUsageMetrics {
    const { aiFlowEvents } = this.dataset;
    const count = (t: string) =>
      aiFlowEvents.filter((e) => e.event_type === t).length;
    const autoReplies = count("auto_reply_sent");
    const handoffs = count("handoff_human") + count("safety_handoff");
    const qualifications =
      count("qualification_detected") +
      aiFlowEvents.filter((e) =>
        String(e.event_type).startsWith("detected_"),
      ).length;
    return {
      autoReplies,
      handoffs,
      qualifications,
      timeSavedMinutes: autoReplies * 3,
    };
  }

  private evolution(): EvolutionSeries {
    // "sales" aqui = leads efetivamente fechados (leads.status='fechado').
    // Orçamento emitido NÃO é venda confirmada.
    const { leads, conversations } = this.dataset;
    const build = (kind: "daily" | "weekly" | "monthly"): EvolutionPoint[] => {
      const m = new Map<string, EvolutionPoint>();
      const bump = (
        iso: string | null | undefined,
        field: keyof Omit<EvolutionPoint, "bucket">,
      ) => {
        if (!iso) return;
        const b = bucketISO(new Date(iso), kind);
        const cur = m.get(b) ?? { bucket: b, leads: 0, conversations: 0, sales: 0 };
        (cur[field] as number) += 1;
        m.set(b, cur);
      };
      for (const l of leads) bump(l.created_at, "leads");
      for (const c of conversations) bump(c.created_at ?? c.updated_at, "conversations");
      for (const l of leads) {
        if (l.status === "fechado") bump(l.closed_at ?? l.updated_at, "sales");
      }
      return [...m.values()].sort((a, b) => (a.bucket < b.bucket ? -1 : 1));
    };
    return {
      daily: build("daily"),
      weekly: build("weekly"),
      monthly: build("monthly"),
    };
  }
}
