// ============================================================================
// SalesIntelligenceAnalyzer — coleta READ-ONLY do CRM existente.
// Consulta apenas: leads, conversations (id, awaiting_reply, last_message_at),
// quotes (metadados) e follow_ups (contagem). Nenhum conteúdo de mensagem.
// Escopo por company_id via RLS (cliente autenticado do usuário).
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { LeadFacts } from "./SalesIntelligenceScoring.server";

export interface AnalyzerOptions {
  activeSince: Date;   // corte para leads considerados ativos
  maxLeads?: number;
}

export class SalesIntelligenceAnalyzer {
  static async collect(
    supabase: SupabaseClient<Database>,
    companyId: string,
    opts: AnalyzerOptions,
  ): Promise<LeadFacts[]> {
    const limit = opts.maxLeads ?? 400;

    // 1) Leads ativos (não fechados/perdidos) OU atualizados no janela.
    const { data: leads, error: leadsErr } = await supabase
      .from("leads")
      .select(
        "id,name,status,lead_temperature_cached,lead_score,estimated_value,created_at,updated_at,next_action_due_at,next_action_label",
      )
      .eq("company_id", companyId)
      .not("status", "in", "(fechado,perdido)")
      .gte("updated_at", opts.activeSince.toISOString())
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (leadsErr) throw new Error("leads_query_failed");
    const leadRows = leads ?? [];
    if (leadRows.length === 0) return [];

    const leadIds = leadRows.map((l) => l.id);

    // 2) Conversas por lead (metadados). Sem conteúdo de mensagens.
    const { data: convs } = await supabase
      .from("conversations")
      .select("lead_id,awaiting_reply,last_message_at")
      .eq("company_id", companyId)
      .in("lead_id", leadIds);
    const convByLead = new Map<string, { awaiting: boolean; lastAt: string | null }>();
    for (const c of convs ?? []) {
      if (!c.lead_id) continue;
      const prev = convByLead.get(c.lead_id);
      if (!prev || (c.last_message_at && (!prev.lastAt || c.last_message_at > prev.lastAt))) {
        convByLead.set(c.lead_id, {
          awaiting: Boolean(c.awaiting_reply),
          lastAt: c.last_message_at ?? prev?.lastAt ?? null,
        });
      }
    }

    // 3) Quotes por lead (metadados apenas).
    const { data: quotes } = await supabase
      .from("quotes")
      .select("lead_id,status,sent_at,valid_until,updated_at")
      .eq("company_id", companyId)
      .in("lead_id", leadIds)
      .order("updated_at", { ascending: false });
    const quoteByLead = new Map<
      string,
      { status: string | null; sentAt: string | null; validUntil: string | null }
    >();
    for (const q of quotes ?? []) {
      if (!q.lead_id || quoteByLead.has(q.lead_id)) continue;
      quoteByLead.set(q.lead_id, {
        status: q.status ?? null,
        sentAt: q.sent_at ?? null,
        validUntil: q.valid_until ?? null,
      });
    }

    // 4) Follow-ups pendentes/enviados por lead.
    const { data: fups } = await supabase
      .from("follow_ups")
      .select("lead_id,status,sent_at")
      .eq("company_id", companyId)
      .in("lead_id", leadIds)
      .order("sent_at", { ascending: false });
    const fupByLead = new Map<string, { pending: number; lastSent: string | null }>();
    for (const f of fups ?? []) {
      if (!f.lead_id) continue;
      const cur = fupByLead.get(f.lead_id) ?? { pending: 0, lastSent: null };
      if (f.status === "sent" || f.status === "scheduled") cur.pending += 1;
      if (!cur.lastSent && f.sent_at) cur.lastSent = f.sent_at;
      fupByLead.set(f.lead_id, cur);
    }

    // 5) Monta LeadFacts.
    return leadRows.map<LeadFacts>((l) => {
      const conv = convByLead.get(l.id);
      const q = quoteByLead.get(l.id);
      const fu = fupByLead.get(l.id);
      const lastActivity =
        conv?.lastAt && conv.lastAt > l.updated_at ? conv.lastAt : l.updated_at;
      return {
        id: l.id,
        name: l.name,
        status: l.status,
        temperature: l.lead_temperature_cached,
        leadScore: l.lead_score ?? 0,
        estimatedValue: l.estimated_value,
        createdAt: l.created_at,
        updatedAt: l.updated_at,
        nextActionDueAt: l.next_action_due_at,
        nextActionLabel: l.next_action_label,
        lastActivityAt: lastActivity,
        conversationAwaitingReply: Boolean(conv?.awaiting),
        conversationLastMessageAt: conv?.lastAt ?? null,
        hasQuote: Boolean(q),
        lastQuoteStatus: q?.status ?? null,
        lastQuoteSentAt: q?.sentAt ?? null,
        lastQuoteValidUntil: q?.validUntil ?? null,
        pendingFollowups: fu?.pending ?? 0,
        lastFollowupSentAt: fu?.lastSent ?? null,
      };
    });
  }
}
