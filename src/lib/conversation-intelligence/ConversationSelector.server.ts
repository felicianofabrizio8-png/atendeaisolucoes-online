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
}

export async function selectConversations(opts: SelectorOptions): Promise<ConversationRaw[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let q = supabaseAdmin
    .from("conversations")
    .select(
      "id, company_id, channel, lead_id, updated_at, last_message_at, " +
        "leads:leads!conversations_lead_id_fkey(status, source, closed_at, lost_at, estimated_value)"
    )
    .eq("company_id", opts.companyId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(opts.limit, 500));

  if (opts.channels?.length) {
    // channel é enum USER-DEFINED; passa como string
    q = q.in("channel", opts.channels as never);
  }
  if (opts.olderThanDays) {
    const cutoff = new Date(Date.now() - opts.olderThanDays * 86400_000).toISOString();
    q = q.lt("last_message_at", cutoff);
  }

  const { data: convs, error } = await q;
  if (error) throw error;
  if (!convs || convs.length === 0) return [];

  const convIds = convs.map((c) => c.id as string);

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
    .select("id, conversation_id, sent, sent_at")
    .eq("company_id", opts.companyId)
    .in("conversation_id", convIds);
  if (qErr) throw qErr;

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

  const quotesByConv = new Map<string, { count: number; last: string | null }>();
  for (const q2 of quotes ?? []) {
    const cid = q2.conversation_id as string | null;
    if (!cid) continue;
    const cur = quotesByConv.get(cid) ?? { count: 0, last: null };
    cur.count += 1;
    const sentAt = (q2.sent_at as string | null) ?? null;
    if (sentAt && (!cur.last || sentAt > cur.last)) cur.last = sentAt;
    quotesByConv.set(cid, cur);
  }

  const result: ConversationRaw[] = convs
    .map((c) => {
      const leadRaw = c.leads as unknown;
      const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
      const l = (lead ?? {}) as {
        status?: string | null;
        source?: string | null;
        closed_at?: string | null;
        lost_at?: string | null;
        estimated_value?: number | null;
      };
      const qi = quotesByConv.get(c.id as string) ?? { count: 0, last: null };
      return {
        conversation_id: c.id as string,
        company_id: c.company_id as string,
        channel: (c.channel as string | null) ?? null,
        lead_id: (c.lead_id as string | null) ?? null,
        lead_status: l.status ?? null,
        lead_source: l.source ?? null,
        lead_closed_at: l.closed_at ?? null,
        lead_lost_at: l.lost_at ?? null,
        lead_estimated_value: l.estimated_value ?? null,
        quote_count: qi.count,
        quote_last_sent_at: qi.last,
        messages: msgsByConv.get(c.id as string) ?? [],
      };
    })
    .filter((c) => {
      if (!opts.onlyTerminated) return true;
      return c.lead_status === "fechado" || c.lead_status === "perdido";
    });

  return result;
}
