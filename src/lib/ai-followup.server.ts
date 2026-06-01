// ============================================================================
// AI Follow-up — server-only
// Detecta candidatos a follow-up automático e envia mensagens humanizadas
// reutilizando o sender já existente (sendWhatsappText). NÃO altera
// meta-send, meta-webhook, engine principal nem Evolution.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsappText } from "@/lib/ai-agent.server";
import { getReadiness } from "@/lib/ai-readiness.server";

export type FollowupRule =
  | "quote_no_reply"
  | "lead_silent"
  | "visit_no_return"
  | "hot_lead_idle"
  | "returning_customer";

export interface FollowupSettings {
  enabled: boolean;
  maxPerLead: number;
  minHoursBetween: number;
  quoteDelayHours: number;
  silenceDelayHours: number;
  visitDelayHours: number;
  hotDelayHours: number;
  businessHoursOnly: boolean;
  businessHoursStart: string;
  businessHoursEnd: string;
  tone: string;
  templates: Record<FollowupRule, string>;
  initialMessage: string | null;
  agentName: string;
}

const DEFAULT_TEMPLATES: Record<FollowupRule, string> = {
  quote_no_reply:
    "Oi {{nome}} 😊 Passando para saber se conseguiu analisar o orçamento. Qualquer dúvida posso te ajudar.",
  lead_silent:
    "Oi {{nome}}! Tudo bem? Continuo à disposição se quiser retomar a conversa.",
  visit_no_return:
    "Oi {{nome}}, espero que a visita tenha sido boa. Quer que eu te passe os próximos passos?",
  hot_lead_idle:
    "Oi {{nome}}, separei tudo aqui para você. Posso te enviar a proposta agora?",
  returning_customer:
    "Que bom te ver por aqui de novo, {{nome}}! Como posso ajudar?",
};

export async function getFollowupSettings(
  companyId: string,
): Promise<FollowupSettings | null> {
  const { data } = await supabaseAdmin
    .from("company_settings")
    .select(
      "ai_followup_enabled, ai_followup_max_per_lead, ai_followup_min_hours_between, ai_followup_quote_delay_hours, ai_followup_silence_delay_hours, ai_followup_visit_delay_hours, ai_followup_hot_delay_hours, ai_followup_business_hours_only, ai_followup_tone, ai_followup_templates, ai_initial_message, ai_agent_name, business_hours_start, business_hours_end",
    )
    .eq("company_id", companyId)
    .maybeSingle();
  if (!data) return null;
  const tpl = (data.ai_followup_templates as Partial<Record<FollowupRule, string>>) ?? {};
  return {
    enabled: !!data.ai_followup_enabled,
    maxPerLead: data.ai_followup_max_per_lead ?? 3,
    minHoursBetween: data.ai_followup_min_hours_between ?? 24,
    quoteDelayHours: data.ai_followup_quote_delay_hours ?? 24,
    silenceDelayHours: data.ai_followup_silence_delay_hours ?? 48,
    visitDelayHours: data.ai_followup_visit_delay_hours ?? 24,
    hotDelayHours: data.ai_followup_hot_delay_hours ?? 4,
    businessHoursOnly: data.ai_followup_business_hours_only ?? true,
    businessHoursStart: data.business_hours_start ?? "09:00:00",
    businessHoursEnd: data.business_hours_end ?? "18:00:00",
    tone: data.ai_followup_tone ?? "amigavel",
    templates: { ...DEFAULT_TEMPLATES, ...tpl },
    initialMessage: data.ai_initial_message,
    agentName: data.ai_agent_name ?? "Fabrizio",
  };
}

function isWithinBusinessHours(s: FollowupSettings, now = new Date()): boolean {
  if (!s.businessHoursOnly) return true;
  const [sh, sm] = s.businessHoursStart.split(":").map(Number);
  const [eh, em] = s.businessHoursEnd.split(":").map(Number);
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= sh * 60 + sm && mins <= eh * 60 + em;
}

function firstName(name: string | null | undefined): string {
  if (!name) return "tudo bem";
  return name.trim().split(/\s+/)[0] || "tudo bem";
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

interface Candidate {
  conversationId: string;
  leadId: string;
  rule: FollowupRule;
  lastClientMessageAt: string | null;
  signal: string;
}

// ----------------------------------------------------------------------------
// Detecção de candidatos
// ----------------------------------------------------------------------------

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

  const candidates: Candidate[] = [];
  for (const c of convs ?? []) {
    if (!c.lead_id) continue;
    if (c.ai_status === "desinteresse" || c.ai_status === "perdido") continue;
    const lastAt = c.last_message_at;

    // hot_lead_idle: lead quente parado > hot delay
    if (
      (c.lead_temperature ?? "").toLowerCase() === "quente" &&
      lastAt &&
      lastAt < cutoffs.hot
    ) {
      candidates.push({
        conversationId: c.id,
        leadId: c.lead_id,
        rule: "hot_lead_idle",
        lastClientMessageAt: lastAt,
        signal: "lead quente sem interação",
      });
      continue;
    }

    // lead_silent: sem mensagem por mais que silenceDelayHours
    if (lastAt && lastAt < cutoffs.silence) {
      candidates.push({
        conversationId: c.id,
        leadId: c.lead_id,
        rule: "lead_silent",
        lastClientMessageAt: lastAt,
        signal: "cliente sumiu",
      });
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
  // procurar conversa do lead
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

// ----------------------------------------------------------------------------
// Validação de envio
// ----------------------------------------------------------------------------

interface SafetyCheck {
  ok: boolean;
  reason?: string;
  attempt?: number;
}

async function canSend(
  companyId: string,
  c: Candidate,
  s: FollowupSettings,
): Promise<SafetyCheck> {
  // Conversa precisa estar elegível agora
  const { data: conv } = await supabaseAdmin
    .from("conversations")
    .select("ai_status, ai_handling, human_takeover_at, last_message_at")
    .eq("id", c.conversationId)
    .maybeSingle();
  if (!conv) return { ok: false, reason: "conversa não encontrada" };
  if (conv.ai_status === "assumido_humano" || conv.human_takeover_at)
    return { ok: false, reason: "humano assumiu" };
  if (conv.ai_status === "desinteresse")
    return { ok: false, reason: "cliente sem interesse" };
  if (conv.ai_handling) return { ok: false, reason: "IA em processamento" };

  // Última mensagem do agente recente? evita spam (janela 24h)
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: recentAgent } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("conversation_id", c.conversationId)
    .eq("role", "agent")
    .gte("at", cutoff)
    .limit(1);
  if (recentAgent && recentAgent.length > 0)
    return { ok: false, reason: "mensagem recente do agente" };

  // Quantidade máxima por lead
  const { data: existing } = await supabaseAdmin
    .from("follow_ups")
    .select("id, sent_at")
    .eq("company_id", companyId)
    .eq("lead_id", c.leadId)
    .order("sent_at", { ascending: false });
  const attempts = existing?.length ?? 0;
  if (attempts >= s.maxPerLead)
    return { ok: false, reason: "máximo de follow-ups atingido" };
  const lastFup = existing?.[0]?.sent_at ?? null;
  if (lastFup) {
    const diffHrs = (Date.now() - new Date(lastFup).getTime()) / 3600_000;
    if (diffHrs < s.minHoursBetween)
      return { ok: false, reason: `aguardando intervalo mínimo (${s.minHoursBetween}h)` };
  }

  // Verifica janela 24h do WhatsApp Cloud API (precisa de cliente em < 24h)
  const cutoff24 = new Date(Date.now() - 23 * 3600 * 1000).toISOString();
  const { data: clientMsg } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("conversation_id", c.conversationId)
    .eq("role", "lead")
    .gte("at", cutoff24)
    .limit(1);
  if (!clientMsg || clientMsg.length === 0)
    return { ok: false, reason: "fora da janela de 24h" };

  return { ok: true, attempt: attempts + 1 };
}

// ----------------------------------------------------------------------------
// Geração da mensagem
// ----------------------------------------------------------------------------

async function buildMessage(
  c: Candidate,
  s: FollowupSettings,
  attempt: number,
): Promise<string> {
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("name, product")
    .eq("id", c.leadId)
    .maybeSingle();
  const tpl = s.templates[c.rule] ?? DEFAULT_TEMPLATES[c.rule];
  const nome = firstName(lead?.name);
  const produto = lead?.product ?? "";
  const msg = renderTemplate(tpl, { nome, produto, agente: s.agentName });
  // Tentativa 2+: adiciona suavização
  if (attempt > 1) {
    return `${msg}\n\nSe preferir, é só responder por aqui quando puder.`;
  }
  return msg;
}

// ----------------------------------------------------------------------------
// Loop principal
// ----------------------------------------------------------------------------

export interface TickResult {
  companyId: string;
  scanned: number;
  sent: number;
  skipped: Array<{ conversationId: string; rule: FollowupRule; reason: string }>;
  errors: string[];
}

export async function runFollowupTickForCompany(
  companyId: string,
): Promise<TickResult> {
  const result: TickResult = {
    companyId,
    scanned: 0,
    sent: 0,
    skipped: [],
    errors: [],
  };
  const s = await getFollowupSettings(companyId);
  if (!s) return result;
  if (!s.enabled) return result;
  if (!isWithinBusinessHours(s)) {
    result.errors.push("fora do horário comercial");
    return result;
  }

  const candidates = await findCandidates(companyId, s);
  result.scanned = candidates.length;

  for (const c of candidates) {
    const check = await canSend(companyId, c, s);
    if (!check.ok) {
      result.skipped.push({
        conversationId: c.conversationId,
        rule: c.rule,
        reason: check.reason ?? "indisponível",
      });
      continue;
    }
    const attempt = check.attempt ?? 1;
    const text = await buildMessage(c, s, attempt);
    const send = await sendWhatsappText({
      companyId,
      conversationId: c.conversationId,
      leadId: c.leadId,
      text,
    });
    if (!send.ok) {
      await supabaseAdmin.from("follow_ups").insert({
        company_id: companyId,
        conversation_id: c.conversationId,
        lead_id: c.leadId,
        rule_type: c.rule,
        attempt_number: attempt,
        message_text: text,
        status: "failed",
        metadata: { signal: c.signal, error: send.error },
      });
      await supabaseAdmin.from("ai_flow_events").insert({
        company_id: companyId,
        conversation_id: c.conversationId,
        lead_id: c.leadId,
        event_type: "followup_failed",
        payload: { rule: c.rule, error: send.error },
      });
      result.errors.push(`${c.rule}: ${send.error}`);
      continue;
    }
    await supabaseAdmin.from("follow_ups").insert({
      company_id: companyId,
      conversation_id: c.conversationId,
      lead_id: c.leadId,
      rule_type: c.rule,
      attempt_number: attempt,
      message_text: text,
      status: "sent",
      metadata: { signal: c.signal, external_id: send.externalId },
    });
    await supabaseAdmin.from("ai_flow_events").insert({
      company_id: companyId,
      conversation_id: c.conversationId,
      lead_id: c.leadId,
      event_type: "followup_sent",
      payload: { rule: c.rule, attempt, signal: c.signal },
    });
    result.sent++;
  }

  return result;
}

export async function runFollowupTickAll(): Promise<TickResult[]> {
  const { data: companies } = await supabaseAdmin
    .from("company_settings")
    .select("company_id")
    .eq("ai_followup_enabled", true);
  const results: TickResult[] = [];
  for (const c of companies ?? []) {
    try {
      results.push(await runFollowupTickForCompany(c.company_id));
    } catch (e) {
      results.push({
        companyId: c.company_id,
        scanned: 0,
        sent: 0,
        skipped: [],
        errors: [e instanceof Error ? e.message : "erro"],
      });
    }
  }
  return results;
}

// ----------------------------------------------------------------------------
// Marca respostas / recuperações (chamado por job periódico)
// ----------------------------------------------------------------------------

export async function reconcileResponses(companyId: string): Promise<number> {
  const { data: pending } = await supabaseAdmin
    .from("follow_ups")
    .select("id, conversation_id, lead_id, sent_at")
    .eq("company_id", companyId)
    .eq("status", "sent")
    .gte("sent_at", new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString())
    .limit(500);
  let updated = 0;
  for (const f of pending ?? []) {
    const { data: reply } = await supabaseAdmin
      .from("messages")
      .select("id, at")
      .eq("conversation_id", f.conversation_id)
      .eq("role", "lead")
      .gt("at", f.sent_at)
      .order("at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!reply) continue;

    // Verifica se virou venda (lead ganho após o follow-up)
    let status: "responded" | "recovered" = "responded";
    if (f.lead_id) {
      const { data: lead } = await supabaseAdmin
        .from("leads")
        .select("status, closed_at")
        .eq("id", f.lead_id)
        .maybeSingle();
      if (lead?.status === "fechado" && lead.closed_at && lead.closed_at > f.sent_at) {
        status = "recovered";
      }
    }
    await supabaseAdmin
      .from("follow_ups")
      .update({ status, responded_at: reply.at, response_outcome: status })
      .eq("id", f.id);
    await supabaseAdmin.from("ai_flow_events").insert({
      company_id: companyId,
      conversation_id: f.conversation_id,
      lead_id: f.lead_id,
      event_type: status === "recovered" ? "lead_recovered" : "followup_responded",
      payload: { followup_id: f.id },
    });
    updated++;
  }
  return updated;
}
