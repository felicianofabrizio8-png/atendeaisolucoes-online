// Seleciona conversas + mensagens da camada operacional (READ-ONLY).
// Usa cliente admin apenas para leitura em jobs batch — nunca escreve nada
// nas tabelas operacionais. Isolamento por company_id é enforce no WHERE.

import type { ConversationRaw, RawMessage } from "./ConversationIntelligenceTypes";

interface SelectorOptions {
  companyId: string;
  limit: number;
  channels?: string[]; // ex.: ['whatsapp','instagram']
  onlyTerminated?: boolean; // status fechado / perdido
  olderThanDays?: number;
  offset?: number;
}

export async function selectConversations(opts: SelectorOptions): Promise<ConversationRaw[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let q = supabaseAdmin
    .from("conversations")
    .select(
      "id, company_id, channel, lead_id, last_message_at, lead_ready_to_close, detected_budget, detected_interest, detected_intent, lead_score",
    )
    .eq("company_id", opts.companyId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range(opts.offset ?? 0, (opts.offset ?? 0) + Math.min(opts.limit, 500) - 1);

  if (opts.channels?.length) {
    q = q.in("channel", opts.channels as never);
  }
  if (opts.olderThanDays) {
    const cutoff = new Date(Date.now() - opts.olderThanDays * 86400_000).toISOString();
    q = q.lt("last_message_at", cutoff);
  }

  const { data: convsData, error } = await q;
  if (error) throw error;
  const convs = (convsData ?? []) as Array<{
    id: string;
    company_id: string;
    channel: string | null;
    lead_id: string | null;
    last_message_at: string | null;
    lead_ready_to_close: boolean | null;
    detected_budget: string | null;
    detected_interest: string | null;
    detected_intent: string | null;
    lead_score: number | null;
  }>;
  if (convs.length === 0) return [];

  const convIds = convs.map((c) => c.id);
  const leadIds = [...new Set(convs.map((c) => c.lead_id).filter((v): v is string => Boolean(v)))];

  const leadMap = new Map<
    string,
    {
      status: string | null;
      source: string | null;
      closed_at: string | null;
      lost_at: string | null;
      estimated_value: number | null;
    }
  >();
  if (leadIds.length > 0) {
    const { data: leadsData } = await supabaseAdmin
      .from("leads")
      .select("id, status, source, closed_at, lost_at, estimated_value")
      .eq("company_id", opts.companyId)
      .in("id", leadIds);
    for (const l of (leadsData ?? []) as Array<{
      id: string;
      status: string | null;
      source: string | null;
      closed_at: string | null;
      lost_at: string | null;
      estimated_value: number | null;
    }>) {
      leadMap.set(l.id, {
        status: l.status,
        source: l.source,
        closed_at: l.closed_at,
        lost_at: l.lost_at,
        estimated_value: l.estimated_value,
      });
    }
  }

  const { data: msgs, error: mErr } = await supabaseAdmin
    .from("messages")
    .select("id, conversation_id, role, text, at, source_subtype")
    .eq("company_id", opts.companyId)
    .in("conversation_id", convIds)
    .is("deleted_at", null)
    .order("at", { ascending: true })
    .limit(20_000);
  if (mErr) throw mErr;

  const { data: quotes, error: qErr } = await supabaseAdmin
    .from("quotes")
    .select("id, conversation_id, sent, sent_at, status")
    .eq("company_id", opts.companyId)
    .in("conversation_id", convIds);
  if (qErr) throw qErr;

  const { data: facts, error: factsError } = await supabaseAdmin
    .from("conversation_facts")
    .select("conversation_id, sale_detected, loss_detected, quote_detected")
    .eq("company_id", opts.companyId)
    .in("conversation_id", convIds);
  if (factsError) throw factsError;

  const { data: followups, error: fErr } = await supabaseAdmin
    .from("follow_ups")
    .select("id, conversation_id")
    .eq("company_id", opts.companyId)
    .in("conversation_id", convIds);
  if (fErr) throw fErr;

  const msgsByConv = new Map<string, RawMessage[]>();
  for (const m of msgs ?? []) {
    const list = msgsByConv.get(m.conversation_id as string) ?? [];
    list.push({
      id: m.id as string,
      role: m.role as RawMessage["role"],
      text: (m.text as string | null) ?? null,
      at: m.at as string,
      source_subtype: (m.source_subtype as string | null) ?? null,
    });
    msgsByConv.set(m.conversation_id as string, list);
  }

  const quotesByConv = new Map<string, { count: number; qualified: number; last: string | null }>();
  for (const q2 of quotes ?? []) {
    const cid = q2.conversation_id as string | null;
    if (!cid) continue;
    const cur = quotesByConv.get(cid) ?? { count: 0, qualified: 0, last: null };
    cur.count += 1;
    if (
      q2.sent === true ||
      q2.sent_at ||
      ["enviado", "visualizado", "aceito"].includes(q2.status as string)
    ) {
      cur.qualified += 1;
    }
    const sentAt = (q2.sent_at as string | null) ?? null;
    if (sentAt && (!cur.last || sentAt > cur.last)) cur.last = sentAt;
    quotesByConv.set(cid, cur);
  }

  const factsByConv = new Map<string, { sale: boolean; loss: boolean; quote: boolean }>();
  for (const fact of facts ?? []) {
    factsByConv.set(fact.conversation_id as string, {
      sale: fact.sale_detected === true,
      loss: fact.loss_detected === true,
      quote: fact.quote_detected === true,
    });
  }

  const followupCountByConv = new Map<string, number>();
  for (const f of followups ?? []) {
    const cid = f.conversation_id as string | null;
    if (!cid) continue;
    followupCountByConv.set(cid, (followupCountByConv.get(cid) ?? 0) + 1);
  }

  const result: ConversationRaw[] = convs
    .map((c) => {
      const l = c.lead_id ? leadMap.get(c.lead_id) : null;
      const qi = quotesByConv.get(c.id) ?? { count: 0, qualified: 0, last: null };
      const fact = factsByConv.get(c.id) ?? { sale: false, loss: false, quote: false };
      const commercialSignalCount = [
        c.lead_ready_to_close === true,
        Boolean(c.detected_budget),
        Boolean(c.detected_interest),
        Boolean(c.detected_intent),
        (c.lead_score ?? 0) >= 50,
      ].filter(Boolean).length;
      return {
        conversation_id: c.id,
        company_id: c.company_id,
        channel: c.channel,
        lead_id: c.lead_id,
        lead_status: l?.status ?? null,
        lead_source: l?.source ?? null,
        lead_closed_at: l?.closed_at ?? null,
        lead_lost_at: l?.lost_at ?? null,
        lead_estimated_value: l?.estimated_value ?? null,
        quote_count: qi.count,
        qualified_quote_count: qi.qualified,
        quote_last_sent_at: qi.last,
        follow_up_count: followupCountByConv.get(c.id) ?? 0,
        last_message_at: c.last_message_at,
        fact_sale_detected: fact.sale,
        fact_loss_detected: fact.loss,
        fact_quote_detected: fact.quote,
        commercial_signal_count: commercialSignalCount,
        messages: msgsByConv.get(c.id) ?? [],
      };
    })
    .filter((c) => {
      if (!opts.onlyTerminated) return true;
      return (
        c.lead_status === "fechado" ||
        c.lead_status === "perdido" ||
        c.fact_sale_detected === true ||
        c.fact_loss_detected === true ||
        c.fact_quote_detected === true ||
        (c.qualified_quote_count ?? 0) > 0
      );
    });

  return result;
}
