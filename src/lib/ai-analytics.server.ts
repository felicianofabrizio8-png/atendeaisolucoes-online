// ============================================================================
// AI Analytics — server-only
// Agrega métricas, conversão, timeline e insights da IA por período.
// Consome apenas dados já existentes (ai_flow_events, conversations, leads,
// quotes, visits). NÃO altera engine, meta-send, meta-webhook ou Evolution.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AnalyticsPeriod = "today" | "7d" | "30d";

export interface AnalyticsRange {
  from: string;
  to: string;
  label: string;
  days: number;
}

export interface AIMetrics {
  leadsAttended: number;
  autoReplies: number;
  handoffs: number;
  qualifiedLeads: number;
  hotLeads: number;
  readyToClose: number;
  timeSavedMinutes: number;
  sendFailures: number;
  preAttended: number;
}

export interface AIConversion {
  aiToQuote: number;
  aiToVisit: number;
  aiToSale: number;
  aiToLost: number;
  conversionRate: number;
  influencedRevenue: number;
  recoveredLeads: number;
}

export interface TimelineItem {
  id: string;
  type: string;
  label: string;
  conversation_id: string | null;
  created_at: string;
}

export interface Insight {
  id: string;
  level: "info" | "good" | "warn";
  text: string;
}

export interface AnalyticsBundle {
  range: AnalyticsRange;
  metrics: AIMetrics;
  conversion: AIConversion;
  hourly: Array<{ hour: number; autoReplies: number; handoffs: number }>;
  topObjections: Array<{ label: string; count: number }>;
  insights: Insight[];
  timeline: TimelineItem[];
}

export function resolveRange(period: AnalyticsPeriod): AnalyticsRange {
  const to = new Date();
  const from = new Date();
  let days = 1;
  let label = "Hoje";
  if (period === "today") {
    from.setHours(0, 0, 0, 0);
    days = 1;
    label = "Hoje";
  } else if (period === "7d") {
    from.setDate(from.getDate() - 7);
    days = 7;
    label = "Últimos 7 dias";
  } else {
    from.setDate(from.getDate() - 30);
    days = 30;
    label = "Últimos 30 dias";
  }
  return { from: from.toISOString(), to: to.toISOString(), label, days };
}

const EVENT_LABEL: Record<string, string> = {
  trigger_enqueued: "Lead entrou",
  auto_reply_sent: "IA respondeu",
  pre_attended: "Pré-atendimento IA",
  qualification_detected: "IA qualificou",
  detected_city: "Cidade detectada",
  detected_pool_size: "Medida detectada",
  detected_objection: "Objeção detectada",
  lead_temperature_changed: "Temperatura alterada",
  lead_bumped_to_hot: "Lead ficou quente",
  ready_to_close: "Pronto para fechar",
  handoff_human: "Humano assumiu",
  safety_handoff: "Handoff de segurança",
  gateway_timeout: "Timeout no gateway",
  send_failed: "Falha de envio",
  agent_error: "Erro do agente",
};

function labelFor(t: string): string {
  return EVENT_LABEL[t] ?? t.replace(/_/g, " ");
}

export async function getAnalytics(
  companyId: string,
  period: AnalyticsPeriod,
): Promise<AnalyticsBundle> {
  const range = resolveRange(period);

  // Eventos de fluxo da IA no período
  const { data: events } = await supabaseAdmin
    .from("ai_flow_events")
    .select("id, event_type, conversation_id, lead_id, payload, created_at")
    .eq("company_id", companyId)
    .gte("created_at", range.from)
    .lte("created_at", range.to)
    .order("created_at", { ascending: false })
    .limit(2000);
  const list = events ?? [];

  // Conversas atualizadas no período (estado atual)
  const { data: convs } = await supabaseAdmin
    .from("conversations")
    .select(
      "id, lead_id, lead_temperature, lead_ready_to_close, lead_score, ai_status, detected_objections, updated_at",
    )
    .eq("company_id", companyId)
    .gte("updated_at", range.from)
    .limit(2000);
  const convList = convs ?? [];

  // IDs de conversas tocadas pela IA no período
  const aiConvIds = new Set<string>();
  for (const e of list) if (e.conversation_id) aiConvIds.add(e.conversation_id);

  // Leads associados a essas conversas
  const aiLeadIds = new Set<string>();
  for (const c of convList) {
    if (aiConvIds.has(c.id) && c.lead_id) aiLeadIds.add(c.lead_id);
  }
  for (const e of list) if (e.lead_id) aiLeadIds.add(e.lead_id);

  const leadIds = Array.from(aiLeadIds);

  // Leads no período com status/valor
  const leadsRes = leadIds.length
    ? await supabaseAdmin
        .from("leads")
        .select("id, status, closed_value, closed_at, lost_at, created_at")
        .eq("company_id", companyId)
        .in("id", leadIds.slice(0, 1000))
    : { data: [] as Array<Record<string, unknown>> };
  const leads = (leadsRes.data ?? []) as Array<{
    id: string;
    status: string;
    closed_value: number | null;
    closed_at: string | null;
    lost_at: string | null;
  }>;

  // Orçamentos/visitas associados a conversas da IA no período
  const aiConvIdArr = Array.from(aiConvIds).slice(0, 1000);
  const [{ data: quotes }, { data: visits }] = await Promise.all([
    aiConvIdArr.length
      ? supabaseAdmin
          .from("quotes")
          .select("id, conversation_id, created_at")
          .eq("company_id", companyId)
          .gte("created_at", range.from)
          .in("conversation_id", aiConvIdArr)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    leadIds.length
      ? supabaseAdmin
          .from("visits")
          .select("id, lead_id, created_at")
          .eq("company_id", companyId)
          .gte("created_at", range.from)
          .in("lead_id", leadIds.slice(0, 1000))
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ]);

  // Métricas
  const count = (t: string) => list.filter((e) => e.event_type === t).length;
  const autoReplies = count("auto_reply_sent");
  const handoffs =
    count("handoff_human") + count("safety_handoff");
  const preAttended = count("pre_attended");
  const sendFailures = count("send_failed") + count("agent_error");
  const qualifiedLeads = new Set(
    list
      .filter(
        (e) =>
          e.event_type === "qualification_detected" ||
          e.event_type.startsWith("detected_"),
      )
      .map((e) => e.conversation_id)
      .filter(Boolean) as string[],
  ).size;
  const hotLeads = convList.filter(
    (c) => (c.lead_temperature ?? "").toLowerCase() === "quente",
  ).length;
  const readyToClose = convList.filter((c) => c.lead_ready_to_close).length;

  const metrics: AIMetrics = {
    leadsAttended: aiConvIds.size,
    autoReplies,
    handoffs,
    qualifiedLeads,
    hotLeads,
    readyToClose,
    timeSavedMinutes: autoReplies * 3,
    sendFailures,
    preAttended,
  };

  // Conversão
  const aiToSale = leads.filter(
    (l) => l.status === "ganho" || (l.closed_at && Number(l.closed_value) > 0),
  ).length;
  const aiToLost = leads.filter((l) => l.status === "perdido" || l.lost_at)
    .length;
  const influencedRevenue = leads.reduce(
    (acc, l) => acc + (Number(l.closed_value) || 0),
    0,
  );
  const aiToQuote = new Set((quotes ?? []).map((q) => q.conversation_id)).size;
  const aiToVisit = (visits ?? []).length;
  const conversionRate =
    aiConvIds.size > 0 ? (aiToSale / aiConvIds.size) * 100 : 0;
  const recoveredLeads = leads.filter(
    (l) => l.status === "ganho",
  ).length; // aproximação: leads ganhos que passaram pela IA

  const conversion: AIConversion = {
    aiToQuote,
    aiToVisit,
    aiToSale,
    aiToLost,
    conversionRate: Math.round(conversionRate * 10) / 10,
    influencedRevenue,
    recoveredLeads,
  };

  // Horário com mais automação (auto_reply + handoff)
  const hourly = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    autoReplies: 0,
    handoffs: 0,
  }));
  for (const e of list) {
    const h = new Date(e.created_at).getHours();
    if (e.event_type === "auto_reply_sent") hourly[h].autoReplies++;
    if (e.event_type === "handoff_human" || e.event_type === "safety_handoff")
      hourly[h].handoffs++;
  }

  // Objeções mais comuns (das conversas)
  const objMap = new Map<string, number>();
  for (const c of convList) {
    for (const o of c.detected_objections ?? []) {
      if (!o) continue;
      objMap.set(o, (objMap.get(o) ?? 0) + 1);
    }
  }
  const topObjections = Array.from(objMap.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // Timeline (últimos 30 eventos relevantes)
  const TIMELINE_TYPES = new Set([
    "trigger_enqueued",
    "auto_reply_sent",
    "pre_attended",
    "qualification_detected",
    "detected_city",
    "detected_pool_size",
    "detected_objection",
    "lead_temperature_changed",
    "lead_bumped_to_hot",
    "ready_to_close",
    "handoff_human",
    "safety_handoff",
  ]);
  const timeline: TimelineItem[] = list
    .filter((e) => TIMELINE_TYPES.has(e.event_type))
    .slice(0, 30)
    .map((e) => ({
      id: e.id,
      type: e.event_type,
      label: labelFor(e.event_type),
      conversation_id: e.conversation_id,
      created_at: e.created_at,
    }));

  // Insights automáticos
  const insights: Insight[] = [];
  if (autoReplies > 0) {
    insights.push({
      id: "saved",
      level: "good",
      text: `IA economizou aproximadamente ${Math.round(
        metrics.timeSavedMinutes / 60,
      )}h de atendimento humano no período (${autoReplies} respostas automáticas).`,
    });
  }
  if (aiConvIds.size > 0 && conversionRate > 0) {
    insights.push({
      id: "conv",
      level: "good",
      text: `Taxa de conversão de leads atendidos pela IA: ${conversionRate.toFixed(
        1,
      )}%.`,
    });
  }
  if (hotLeads > 0) {
    insights.push({
      id: "hot",
      level: "info",
      text: `${hotLeads} leads quentes detectados — priorize na fila do Inbox.`,
    });
  }
  if (readyToClose > 0) {
    insights.push({
      id: "ready",
      level: "good",
      text: `${readyToClose} leads prontos para fechar identificados pela IA.`,
    });
  }
  if (handoffs > 0 && aiConvIds.size > 0) {
    const ratio = Math.round((handoffs / aiConvIds.size) * 100);
    insights.push({
      id: "handoff",
      level: ratio > 60 ? "warn" : "info",
      text: `${ratio}% das conversas foram transferidas para humano (${handoffs}/${aiConvIds.size}).`,
    });
  }
  if (sendFailures > 0) {
    insights.push({
      id: "fail",
      level: "warn",
      text: `${sendFailures} falhas de envio detectadas — verifique a integração WhatsApp.`,
    });
  }
  const peak = [...hourly].sort((a, b) => b.autoReplies - a.autoReplies)[0];
  if (peak && peak.autoReplies > 0) {
    insights.push({
      id: "peak",
      level: "info",
      text: `Pico de automação às ${String(peak.hour).padStart(
        2,
        "0",
      )}h (${peak.autoReplies} respostas).`,
    });
  }
  if (topObjections[0]) {
    insights.push({
      id: "obj",
      level: "info",
      text: `Objeção mais comum: "${topObjections[0].label}" (${topObjections[0].count}x).`,
    });
  }

  return { range, metrics, conversion, hourly, topObjections, insights, timeline };
}
