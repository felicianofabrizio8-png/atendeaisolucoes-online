// ============================================================================
// followup/candidates.ts
// Responsabilidade: detectar conversas elegíveis para follow-up, classificar
// por regra e deduplicar por conversa priorizando a regra mais "quente".
// Lê apenas — não envia mensagens nem escreve em follow_ups.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Candidate, FollowupRule, FollowupSettings } from "./types";

export async function findCandidates(
  companyId: string,
  settings: FollowupSettings,
  limit = 25,
): Promise<Candidate[]> {
  const now = Date.now();
  const cutoffs = {
    quote: new Date(now - settings.quoteDelayHours * 3600_000).toISOString(),
    silence: new Date(now - settings.silenceDelayHours * 3600_000).toISOString(),
    visit: new Date(now - settings.visitDelayHours * 3600_000).toISOString(),
    hot: new Date(now - settings.hotDelayHours * 3600_000).toISOString(),
  };

  // Conversas "vivas" (não assumidas por humano com handoff explícito recente,
  // não fechadas como desinteresse)
  const { data: convs } = await supabaseAdmin
    .from("conversations")
    .select(
      "id, lead_id, ai_status, lead_temperature, lead_ready_to_close, last_message_at, updated_at",
    )
    .eq("company_id", companyId)
    .lte("last_message_at", cutoffs.hot)
    .order("last_message_at", { ascending: false })
    .limit(200);

  // Helper: confere se a última mensagem foi do cliente (lead). Evita disparar
  // logo após o agente ter respondido.
  async function lastMessageWasFromLead(convId: string): Promise<boolean> {
    const { data } = await supabaseAdmin
      .from("messages")
      .select("role")
      .eq("conversation_id", convId)
      .order("at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.role === "lead";
  }

  const candidates: Candidate[] = [];
  for (const c of convs ?? []) {
    if (!c.lead_id) continue;
    if (c.ai_status === "desinteresse" || c.ai_status === "perdido") continue;
    const lastAt = c.last_message_at;

    // hot_lead_idle: lead quente parado > hot delay, mas só se o cliente foi
    // o último a falar (não disparar logo após resposta do agente).
    if (
      (c.lead_temperature ?? "").toLowerCase() === "quente" &&
      lastAt &&
      lastAt < cutoffs.hot
    ) {
      if (await lastMessageWasFromLead(c.id)) {
        candidates.push({
          conversationId: c.id,
          leadId: c.lead_id,
          rule: "hot_lead_idle",
          lastClientMessageAt: lastAt,
          signal: "lead quente sem interação",
        });
      }
      continue;
    }

    // lead_silent: sem mensagem por mais que silenceDelayHours, e cliente foi
    // o último a falar (senão estamos esperando resposta dele do nosso lado).
    if (lastAt && lastAt < cutoffs.silence) {
      if (await lastMessageWasFromLead(c.id)) {
        candidates.push({
          conversationId: c.id,
          leadId: c.lead_id,
          rule: "lead_silent",
          lastClientMessageAt: lastAt,
          signal: "cliente sumiu",
        });
      }
    }
  }

  // quote_no_reply: orçamento enviado há mais de quoteDelayHours sem resposta
  const { data: quotes } = await supabaseAdmin
    .from("quotes")
    .select("id, conversation_id, lead_id, sent_at")
    .eq("company_id", companyId)
    .eq("sent", true)
    .not("conversation_id", "is", null)
    .lte("sent_at", cutoffs.quote)
    .order("sent_at", { ascending: false })
    .limit(100);
  for (const q of quotes ?? []) {
    if (!q.conversation_id || !q.lead_id) continue;
    candidates.push({
      conversationId: q.conversation_id,
      leadId: q.lead_id,
      rule: "quote_no_reply",
      lastClientMessageAt: q.sent_at,
      signal: "orçamento enviado sem resposta",
    });
  }

  // visit_no_return: visita realizada há mais de visitDelayHours
  const { data: visits } = await supabaseAdmin
    .from("visits")
    .select("id, lead_id, scheduled_at, status")
    .eq("company_id", companyId)
    .eq("status", "concluida")
    .lte("scheduled_at", cutoffs.visit)
    .limit(100);
  const visitLeadIds = (visits ?? []).map((v) => v.lead_id).filter(Boolean) as string[];
  if (visitLeadIds.length) {
    const { data: leadConvs } = await supabaseAdmin
      .from("conversations")
      .select("id, lead_id")
      .eq("company_id", companyId)
      .in("lead_id", visitLeadIds)
      .order("last_message_at", { ascending: false });
    const convByLead = new Map<string, string>();
    for (const lc of leadConvs ?? []) {
      if (lc.lead_id && !convByLead.has(lc.lead_id)) convByLead.set(lc.lead_id, lc.id);
    }
    for (const v of visits ?? []) {
      if (!v.lead_id) continue;
      const convId = convByLead.get(v.lead_id);
      if (!convId) continue;
      candidates.push({
        conversationId: convId,
        leadId: v.lead_id,
        rule: "visit_no_return",
        lastClientMessageAt: v.scheduled_at,
        signal: "visita realizada sem retorno",
      });
    }
  }

  // returning_customer: lead já fechado/perdido há ≥ 7 dias que voltou a
  // mandar mensagem nas últimas 24h (reativação). Sinal forte de oportunidade.
  const reactivationCutoff = new Date(now - 7 * 24 * 3600_000).toISOString();
  const recentLeadMsgCutoff = new Date(now - 24 * 3600_000).toISOString();
  const { data: returnedLeads } = await supabaseAdmin
    .from("leads")
    .select("id, status, closed_at, lost_at")
    .eq("company_id", companyId)
    .in("status", ["fechado", "perdido"])
    .limit(200);
  const returnedIds = (returnedLeads ?? [])
    .filter((l) => {
      const ref = l.closed_at ?? l.lost_at;
      return ref && ref < reactivationCutoff;
    })
    .map((l) => l.id);
  if (returnedIds.length) {
    const { data: rConvs } = await supabaseAdmin
      .from("conversations")
      .select("id, lead_id, last_message_at")
      .eq("company_id", companyId)
      .in("lead_id", returnedIds)
      .gte("last_message_at", recentLeadMsgCutoff);
    for (const rc of rConvs ?? []) {
      if (!rc.lead_id) continue;
      const { data: lastMsg } = await supabaseAdmin
        .from("messages")
        .select("role, at")
        .eq("conversation_id", rc.id)
        .order("at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastMsg?.role !== "lead") continue;
      candidates.push({
        conversationId: rc.id,
        leadId: rc.lead_id,
        rule: "returning_customer",
        lastClientMessageAt: lastMsg.at,
        signal: "cliente antigo voltou a interagir",
      });
    }
  }

  // Deduplica por conversa, priorizando regras mais "quentes"
  const priority: Record<FollowupRule, number> = {
    hot_lead_idle: 5,
    quote_no_reply: 4,
    visit_no_return: 3,
    returning_customer: 2,
    lead_silent: 1,
  };
  const best = new Map<string, Candidate>();
  for (const c of candidates) {
    const cur = best.get(c.conversationId);
    if (!cur || priority[c.rule] > priority[cur.rule]) best.set(c.conversationId, c);
  }
  return Array.from(best.values()).slice(0, limit);
}
