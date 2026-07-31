// ============================================================================
// Leitura de UMA conversa para o Recovery AI Assistant.
//
// Reusa integralmente o motor puro da Fase 6.1 (`assessRecovery`) — nenhuma
// regra de score, chance, janela ou classificação é reimplementada aqui.
//
// SEGURANÇA: `companyId` vem sempre do perfil do usuário autenticado (JWT).
// Toda consulta filtra por ele; se a conversa pertencer a outra empresa, a
// leitura devolve `null` e o endpoint responde 404.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  assessRecovery,
  type ApprovedTemplate,
  type RecoveryAssessment,
  type RecoverySnapshot,
} from "@/lib/recovery";
import type { RecoveryTemplateRef, SafeMessage } from "./types";

/** Mensagens lidas para montar o resumo — teto defensivo. */
const MESSAGE_LIMIT = 40;

export interface SingleRecoveryRead {
  assessment: RecoveryAssessment;
  messages: SafeMessage[];
  templates: RecoveryTemplateRef[];
  tags: string[];
  source: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;

function roleOf(role: string): SafeMessage["role"] {
  if (role === "lead") return "cliente";
  if (role === "agent" || role === "user") return "vendedor";
  return "sistema";
}

export async function readSingleRecovery(
  companyId: string,
  conversationId: string,
  now: number,
): Promise<SingleRecoveryRead | null> {
  const { data: conv } = await supabaseAdmin
    .from("conversations")
    .select("id, lead_id, channel, last_message_at, lead_temperature")
    .eq("company_id", companyId)
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return null;
  const c = conv as Row;

  const [leadRes, msgRes, quoteRes, visitRes, followRes, coachRes, tplRes] = await Promise.all([
    supabaseAdmin
      .from("leads")
      .select(
        "id, name, product, status, estimated_value, source, tags, assigned_to, lead_temperature_cached, lost_at, closed_at, reactivated_at",
      )
      .eq("company_id", companyId)
      .eq("id", c.lead_id)
      .maybeSingle(),
    supabaseAdmin
      .from("messages")
      .select("role, at, text")
      .eq("company_id", companyId)
      .eq("conversation_id", conversationId)
      .is("deleted_at", null)
      .order("at", { ascending: false })
      .limit(MESSAGE_LIMIT),
    supabaseAdmin
      .from("quotes")
      .select("sent_at, viewed_at, status, final_value, total, created_at")
      .eq("company_id", companyId)
      .eq("lead_id", c.lead_id)
      .order("created_at", { ascending: false })
      .limit(1),
    supabaseAdmin
      .from("visits")
      .select("scheduled_at, status")
      .eq("company_id", companyId)
      .eq("lead_id", c.lead_id)
      .order("scheduled_at", { ascending: false })
      .limit(1),
    supabaseAdmin
      .from("follow_ups")
      .select("sent_at, responded_at")
      .eq("company_id", companyId)
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: false })
      .limit(5),
    supabaseAdmin
      .from("coach_suggestions")
      .select("risk_score, urgency")
      .eq("company_id", companyId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(1),
    supabaseAdmin.from("whatsapp_templates").select("id, name, status").eq("company_id", companyId),
  ]);

  const lead = (leadRes as Row)?.data as Row | null;
  if (!lead) return null;

  const rawMsgs = (((msgRes as Row)?.data ?? []) as Row[]).filter((m) => m?.at);
  // A consulta vem decrescente; o motor e o resumo trabalham em ordem crescente.
  const ordered = [...rawMsgs].reverse();

  const messages: SafeMessage[] = ordered
    .filter((m) => typeof m.text === "string" && m.text.trim())
    .map((m) => ({ role: roleOf(String(m.role)), at: String(m.at), text: String(m.text) }));

  let lastInbound: string | null = null;
  let lastOutbound: string | null = null;
  for (const m of rawMsgs) {
    if (m.role === "lead") {
      if (!lastInbound) lastInbound = m.at;
    } else if (!lastOutbound) {
      lastOutbound = m.at;
    }
  }

  const quote = (((quoteRes as Row)?.data ?? []) as Row[])[0] ?? null;
  const visit = (((visitRes as Row)?.data ?? []) as Row[])[0] ?? null;
  const follows = ((followRes as Row)?.data ?? []) as Row[];
  const coach = (((coachRes as Row)?.data ?? []) as Row[])[0] ?? null;
  const templates = (((tplRes as Row)?.data ?? []) as Row[]).map((t) => ({
    id: String(t.id),
    name: String(t.name),
    status: String(t.status ?? ""),
  })) as ApprovedTemplate[];

  const snap: RecoverySnapshot = {
    conversationId: c.id,
    leadId: lead.id,
    leadName: lead.name,
    product: lead.product,
    channel: c.channel,
    leadStatus: lead.status,
    temperature: c.lead_temperature ?? lead.lead_temperature_cached ?? null,
    estimatedValue: lead.estimated_value != null ? Number(lead.estimated_value) : null,
    source: lead.source,
    tags: lead.tags ?? [],
    assignedTo: lead.assigned_to,
    assignedToName: null,
    lastInboundAt: lastInbound,
    lastOutboundAt: lastOutbound,
    lastMessageAt: c.last_message_at ?? rawMsgs[0]?.at ?? null,
    firstMessageAt: ordered[0]?.at ?? null,
    messageCount: rawMsgs.length,
    quote: quote
      ? {
          sentAt: quote.sent_at ?? null,
          viewedAt: quote.viewed_at ?? null,
          status: quote.status ?? null,
          total: quote.final_value ?? quote.total ?? null,
        }
      : null,
    visit: visit ? { scheduledAt: visit.scheduled_at ?? null, status: visit.status ?? null } : null,
    lastFollowUpAt: follows[0]?.sent_at ?? null,
    followUpResponded: follows.some((f) => !!f.responded_at),
    coachRiskScore: coach?.risk_score ?? null,
    coachUrgency: (coach?.urgency as RecoverySnapshot["coachUrgency"]) ?? null,
    lostAt: lead.lost_at,
    closedAt: lead.closed_at,
    reactivatedAt: lead.reactivated_at,
  };

  return {
    assessment: assessRecovery(snap, now, templates),
    messages,
    templates: templates.map((t) => ({ name: t.name, status: t.status })),
    tags: lead.tags ?? [],
    source: lead.source ?? null,
  };
}
