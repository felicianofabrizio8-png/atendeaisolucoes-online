// Recovery dashboard — lista conversas WhatsApp fora da janela de 24h
// e calcula indicadores de recuperação de leads.
// Não altera nada do fluxo do Inbox; apenas lê dados existentes.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecoveryItem {
  conversationId: string;
  leadId: string;
  name: string;
  phone: string | null;
  product: string | null;
  leadStatus: string;
  lastInboundAt: string | null;
  hoursSince: number;
  lastMessageText: string | null;
  hasQuote: boolean;
  hasVisit: boolean;
}

export interface RecoveryMetrics {
  outOfWindowCount: number;
  templatesSentToday: number;
  responseRate: number;
  reactivatedLeads: number;
  recoveredSales: number;
}

export interface RecoveryDashboard {
  items: RecoveryItem[];
  metrics: RecoveryMetrics;
}




export const getRecoveryDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RecoveryDashboard> => {
    const ctxAny = context as unknown as { supabase: any; userId: string };
    const supabase = ctxAny.supabase;
    const userId = ctxAny.userId;


    const { data: prof } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    const companyId = (prof as { company_id?: string } | null)?.company_id;
    if (!companyId) {
      return {
        items: [],
        metrics: {
          outOfWindowCount: 0,
          templatesSentToday: 0,
          responseRate: 0,
          reactivatedLeads: 0,
          recoveredSales: 0,
        },
      };
    }

    const nowMs = Date.now();
    const cutoffIso = new Date(nowMs - DAY_MS).toISOString();

    // 1) Conversas WhatsApp com última mensagem > 24h
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, lead_id, last_message_at, channel")
      .eq("company_id", companyId)
      .eq("channel", "whatsapp")
      .lt("last_message_at", cutoffIso)
      .order("last_message_at", { ascending: false })
      .limit(200);

    const convList = (convs as Array<{
      id: string;
      lead_id: string;
      last_message_at: string;
    }> | null) ?? [];

    if (convList.length === 0) {
      const metrics = await computeMetrics(supabase, companyId, nowMs);
      return { items: [], metrics };
    }

    const leadIds = [...new Set(convList.map((c) => c.lead_id))];
    const convIds = convList.map((c) => c.id);

    const [leadsRes, quotesRes, visitsRes, lastInboundRes] = await Promise.all([
      supabase
        .from("leads")
        .select("id, name, phone, product, status")
        .in("id", leadIds),
      supabase
        .from("quotes")
        .select("lead_id")
        .in("lead_id", leadIds),
      supabase
        .from("visits")
        .select("lead_id")
        .in("lead_id", leadIds),
      // Últimas mensagens INBOUND por conversa (role=lead)
      supabase
        .from("messages")
        .select("conversation_id, text, at, role")
        .in("conversation_id", convIds)
        .eq("role", "lead")
        .order("at", { ascending: false })
        .limit(500),
    ]);

    const leads = ((leadsRes as { data?: Array<{
      id: string;
      name: string;
      phone: string | null;
      product: string | null;
      status: string;
    }> }).data ?? []);
    const leadById = new Map(leads.map((l) => [l.id, l]));

    const quoteSet = new Set(
      ((quotesRes as { data?: Array<{ lead_id: string }> }).data ?? []).map(
        (q) => q.lead_id,
      ),
    );
    const visitSet = new Set(
      ((visitsRes as { data?: Array<{ lead_id: string }> }).data ?? []).map(
        (v) => v.lead_id,
      ),
    );

    const lastInboundByConv = new Map<
      string,
      { text: string; at: string }
    >();
    for (const m of ((lastInboundRes as { data?: Array<{
      conversation_id: string;
      text: string;
      at: string;
    }> }).data ?? [])) {
      if (!lastInboundByConv.has(m.conversation_id)) {
        lastInboundByConv.set(m.conversation_id, { text: m.text, at: m.at });
      }
    }

    const items: RecoveryItem[] = convList
      .map((c) => {
        const lead = leadById.get(c.lead_id);
        if (!lead) return null;
        const inbound = lastInboundByConv.get(c.id);
        const lastAt = inbound?.at ?? c.last_message_at;
        const hoursSince = (nowMs - new Date(lastAt).getTime()) / (60 * 60 * 1000);
        if (hoursSince < 24) return null;
        return {
          conversationId: c.id,
          leadId: lead.id,
          name: lead.name,
          phone: lead.phone,
          product: lead.product,
          leadStatus: lead.status,
          lastInboundAt: inbound?.at ?? null,
          hoursSince,
          lastMessageText: inbound?.text ?? null,
          hasQuote: quoteSet.has(lead.id),
          hasVisit: visitSet.has(lead.id),
        } as RecoveryItem;
      })
      .filter((x): x is RecoveryItem => x !== null);

    const metrics = await computeMetrics(supabase, companyId, nowMs, items.length);
    return { items, metrics };
  });

async function computeMetrics(
  supabase: any,
  companyId: string,
  nowMs: number,
  outOfWindowCount?: number,
): Promise<RecoveryMetrics> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const last30 = new Date(nowMs - 30 * DAY_MS).toISOString();

  // Templates enviados (manualmente) hoje
  const { data: sentToday } = await supabase
    .from("messages")
    .select("id")
    .eq("company_id", companyId)
    .eq("source_subtype", "wa_template_manual")
    .gte("at", startOfToday.toISOString());

  // Templates manuais nos últimos 30 dias para calcular taxa de resposta e reativação
  const { data: sent30 } = await supabase
    .from("messages")
    .select("id, conversation_id, at")
    .eq("company_id", companyId)
    .eq("source_subtype", "wa_template_manual")
    .gte("at", last30);

  const sent30Arr = (sent30 as Array<{
    id: string;
    conversation_id: string;
    at: string;
  }> | null) ?? [];

  let responded = 0;
  const reactivatedConvIds = new Set<string>();

  if (sent30Arr.length > 0) {
    const convIds = [...new Set(sent30Arr.map((m) => m.conversation_id))];
    const { data: replies } = await supabase
      .from("messages")
      .select("conversation_id, at, role")
      .in("conversation_id", convIds)
      .eq("role", "lead")
      .gte("at", last30);

    const repliesByConv = new Map<string, string[]>();
    for (const r of (replies as Array<{
      conversation_id: string;
      at: string;
    }> | null) ?? []) {
      const arr = repliesByConv.get(r.conversation_id) ?? [];
      arr.push(r.at);
      repliesByConv.set(r.conversation_id, arr);
    }

    for (const send of sent30Arr) {
      const sendTime = new Date(send.at).getTime();
      const arr = repliesByConv.get(send.conversation_id) ?? [];
      const replied = arr.some((t) => {
        const dt = new Date(t).getTime();
        return dt >= sendTime && dt <= sendTime + DAY_MS;
      });
      if (replied) {
        responded += 1;
        reactivatedConvIds.add(send.conversation_id);
      }
    }
  }

  // Vendas recuperadas = leads das conversas reativadas que estão ganhos
  let recoveredSales = 0;
  if (reactivatedConvIds.size > 0) {
    const { data: convs2 } = await supabase
      .from("conversations")
      .select("lead_id")
      .in("id", [...reactivatedConvIds]);
    const leadIds2 = [
      ...new Set(
        ((convs2 as Array<{ lead_id: string }> | null) ?? []).map(
          (c) => c.lead_id,
        ),
      ),
    ];
    if (leadIds2.length > 0) {
      const { data: wonLeads } = await supabase
        .from("leads")
        .select("id, status")
        .in("id", leadIds2)
        .eq("status", "ganho");
      recoveredSales = ((wonLeads as Array<unknown> | null) ?? []).length;
    }
  }

  const sentTodayCount = ((sentToday as Array<unknown> | null) ?? []).length;
  const sent30Count = sent30Arr.length;
  const responseRate = sent30Count > 0 ? responded / sent30Count : 0;

  let resolvedOutOfWindow = outOfWindowCount;
  if (resolvedOutOfWindow === undefined) {
    const cutoffIso = new Date(nowMs - DAY_MS).toISOString();
    const { data: c } = await supabase
      .from("conversations")
      .select("id")
      .eq("company_id", companyId)
      .eq("channel", "whatsapp")
      .lt("last_message_at", cutoffIso);
    resolvedOutOfWindow = ((c as Array<unknown> | null) ?? []).length;
  }

  return {
    outOfWindowCount: resolvedOutOfWindow ?? 0,
    templatesSentToday: sentTodayCount,
    responseRate,
    reactivatedLeads: reactivatedConvIds.size,
    recoveredSales,
  };
}
