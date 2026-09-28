// ============================================================================
// followup/candidates.ts
// Responsabilidade: detectar negociações em que NÓS falamos por último e o
// cliente não respondeu — candidatas a abrir um ciclo de follow-up.
// Lê apenas; não envia nem escreve.
//
// Regras (Follow-up V2):
//  - follow-up = mensagem nossa, orçamento ou visita sem resposta;
//  - cliente esperando resposta NÃO é follow-up: é pendência de atendimento
//    (contada à parte, para visibilidade);
//  - referência vale por no máximo REFERENCE_MAX_AGE_DAYS (sem elegibilidade
//    eterna de orçamento/visita antigos);
//  - venda fechada/perdida, humano assumiu ou desinteresse: fora;
//  - uma nova negociação (referência posterior ao fim do último ciclo) pode
//    abrir outro ciclo para o mesmo lead.
// Prioridade do motivo: orçamento > visita > lead quente > silêncio.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { MESSAGE_REFERENCE_MAX_AGE_DAYS, REFERENCE_MAX_AGE_DAYS } from "./next-contact";
import type { Candidate, FollowupSettings } from "./types";

/** Não abre ciclo em cima de uma mensagem nossa de minutos atrás. */
export const OPEN_GRACE_MINUTES = 60;

const OPEN_QUOTE_STATUSES = ["enviado", "visualizado"];
const BLOCKING_AI_STATUS = ["assumido_humano", "desinteresse", "perdido"];

export type OpportunityCandidate = Candidate & { supersedesCycleId?: string };

export interface ConversationRow {
  id: string;
  lead_id: string | null;
  ai_status: string | null;
  human_takeover_at: string | null;
  lead_temperature: string | null;
  last_message_at?: string | null;
}

interface CycleSnapshot {
  id: string;
  conversation_id: string;
  state: string;
  reference_at: string;
  closed_at: string | null;
}

interface Context {
  closedLeads: Set<string>;
  latestCycle: Map<string, CycleSnapshot>;
  quoteByConv: Map<string, { id: string; sent_at: string }>;
  visitByLead: Map<string, { id: string; scheduled_at: string }>;
}

export type Classification =
  | { kind: "candidate"; candidate: OpportunityCandidate }
  | { kind: "active"; cycleId: string }
  | { kind: "pending_attendance" }
  | { kind: "none"; reason: string };

/** Contexto em lote (leads, ciclos, orçamentos e visitas) das conversas. */
async function loadContext(
  companyId: string,
  convs: ConversationRow[],
  window: { from: string; to: string },
): Promise<Context> {
  const convIds = convs.map((c) => c.id);
  const leadIds = [...new Set(convs.map((c) => c.lead_id).filter(Boolean) as string[])];
  const [{ data: leads }, { data: cycles }, { data: quotes }, { data: visits }] = await Promise.all(
    [
      supabaseAdmin
        .from("leads")
        .select("id, status, closed_at, lost_at")
        .eq("company_id", companyId)
        .in("id", leadIds),
      supabaseAdmin
        .from("followup_cycles")
        .select("id, conversation_id, state, reference_at, closed_at, created_at")
        .eq("company_id", companyId)
        .in("conversation_id", convIds)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("quotes")
        .select("id, conversation_id, sent_at, status")
        .eq("company_id", companyId)
        .eq("sent", true)
        .in("conversation_id", convIds)
        .gte("sent_at", window.from)
        .lte("sent_at", window.to)
        .order("sent_at", { ascending: false }),
      supabaseAdmin
        .from("visits")
        .select("id, lead_id, scheduled_at")
        .eq("company_id", companyId)
        .eq("status", "concluida")
        .in("lead_id", leadIds)
        .gte("scheduled_at", window.from)
        .lte("scheduled_at", window.to)
        .order("scheduled_at", { ascending: false }),
    ],
  );

  const ctx: Context = {
    closedLeads: new Set(
      (leads ?? [])
        .filter((l) => l.status === "fechado" || l.status === "perdido" || l.closed_at || l.lost_at)
        .map((l) => l.id),
    ),
    latestCycle: new Map(),
    quoteByConv: new Map(),
    visitByLead: new Map(),
  };
  for (const c of cycles ?? [])
    if (!ctx.latestCycle.has(c.conversation_id)) ctx.latestCycle.set(c.conversation_id, c);
  for (const q of quotes ?? []) {
    if (
      q.conversation_id &&
      q.sent_at &&
      OPEN_QUOTE_STATUSES.includes(q.status) &&
      !ctx.quoteByConv.has(q.conversation_id)
    )
      ctx.quoteByConv.set(q.conversation_id, { id: q.id, sent_at: q.sent_at });
  }
  for (const v of visits ?? []) {
    if (v.lead_id && v.scheduled_at && !ctx.visitByLead.has(v.lead_id))
      ctx.visitByLead.set(v.lead_id, { id: v.id, scheduled_at: v.scheduled_at });
  }
  return ctx;
}

/** Classifica UMA conversa: abre ciclo, já tem ciclo, pendência ou nada. */
async function classify(
  companyId: string,
  c: ConversationRow,
  ctx: Context,
  opts: { now: Date; messageMaxAgeDays?: number },
): Promise<Classification> {
  const leadId = c.lead_id;
  if (!leadId) return { kind: "none", reason: "conversa sem lead" };
  if (c.human_takeover_at || c.ai_status === "assumido_humano")
    return { kind: "none", reason: "atendimento assumido por humano" };
  if (c.ai_status === "desinteresse") return { kind: "none", reason: "cliente sem interesse" };
  if (c.ai_status === "perdido" || ctx.closedLeads.has(leadId))
    return { kind: "none", reason: "venda fechada ou perdida" };

  // Atalhos sem consulta (o tick passa por centenas de conversas):
  // ciclo ativo sem orçamento/visita mais novo segue como está; ciclo
  // encerrado sem nada novo na conversa desde então não reabre.
  const prior = ctx.latestCycle.get(c.id);
  const quote = ctx.quoteByConv.get(c.id);
  const visit = ctx.visitByLead.get(leadId);
  const newestObjectMs = Math.max(
    quote ? Date.parse(quote.sent_at) : 0,
    visit ? Date.parse(visit.scheduled_at) : 0,
  );
  if (prior?.state === "active" && newestObjectMs <= Date.parse(prior.reference_at))
    return { kind: "active", cycleId: prior.id };
  if (
    prior?.closed_at &&
    c.last_message_at &&
    Date.parse(c.last_message_at) <= Date.parse(prior.closed_at) &&
    newestObjectMs <= Date.parse(prior.closed_at)
  )
    return { kind: "none", reason: "negociação já acompanhada, sem novidade desde o fim do ciclo" };

  const { data: lastMsg } = await supabaseAdmin
    .from("messages")
    .select("id, role, at")
    .eq("company_id", companyId)
    .eq("conversation_id", c.id)
    .in("role", ["lead", "agent"])
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lastMsg) return { kind: "none", reason: "conversa sem mensagens" };
  if (lastMsg.role === "lead") return { kind: "pending_attendance" };

  const { data: lastLead } = await supabaseAdmin
    .from("messages")
    .select("at")
    .eq("company_id", companyId)
    .eq("conversation_id", c.id)
    .eq("role", "lead")
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastLeadMs = lastLead?.at ? Date.parse(lastLead.at) : 0;

  let candidate: Candidate;
  if (quote && Date.parse(quote.sent_at) > lastLeadMs) {
    candidate = {
      conversationId: c.id,
      leadId,
      rule: "quote_no_reply",
      referenceKey: `quote:${quote.id}`,
      referenceAt: quote.sent_at,
      signal: "orçamento enviado sem resposta",
    };
  } else if (visit && Date.parse(visit.scheduled_at) > lastLeadMs) {
    candidate = {
      conversationId: c.id,
      leadId,
      rule: "visit_no_return",
      referenceKey: `visit:${visit.id}`,
      referenceAt: visit.scheduled_at,
      signal: "visita realizada sem retorno",
    };
  } else {
    if (
      opts.messageMaxAgeDays !== undefined &&
      opts.now.getTime() - Date.parse(lastMsg.at) > opts.messageMaxAgeDays * 24 * 3600_000
    )
      return { kind: "none", reason: "conversa parada há muito tempo — caso de reativação" };
    const hot = (c.lead_temperature ?? "").toLowerCase() === "quente";
    candidate = {
      conversationId: c.id,
      leadId,
      rule: hot ? "hot_lead_idle" : "lead_silent",
      referenceKey: `msg:${lastMsg.id}`,
      referenceAt: lastMsg.at,
      signal: hot ? "lead quente sem resposta à nossa mensagem" : "nossa mensagem sem resposta",
    };
  }

  if (prior?.state === "active") {
    // Orçamento/visita novos numa negociação em curso: o ciclo passa a
    // acompanhar a nova referência (o antigo encerra como "superseded").
    const newerObject =
      (candidate.rule === "quote_no_reply" || candidate.rule === "visit_no_return") &&
      Date.parse(candidate.referenceAt) > Date.parse(prior.reference_at);
    return newerObject
      ? { kind: "candidate", candidate: { ...candidate, supersedesCycleId: prior.id } }
      : { kind: "active", cycleId: prior.id };
  }
  // Novo ciclo só para referência posterior ao fim do anterior — nossos
  // próprios follow-ups nunca reabrem a mesma negociação.
  if (prior?.closed_at && Date.parse(candidate.referenceAt) <= Date.parse(prior.closed_at))
    return { kind: "none", reason: "negociação já acompanhada, sem novidade desde o fim do ciclo" };
  return { kind: "candidate", candidate };
}

export interface ScanResult {
  candidates: OpportunityCandidate[];
  pendingAttendance: number;
}

/** Varredura do tick: conversas paradas entre o prazo de carência e o limite de idade. */
export async function scanFollowupOpportunities(
  companyId: string,
  _settings: FollowupSettings,
  { limit = 50, now = new Date() }: { limit?: number; now?: Date } = {},
): Promise<ScanResult> {
  const window = {
    from: new Date(now.getTime() - REFERENCE_MAX_AGE_DAYS * 24 * 3600_000).toISOString(),
    to: new Date(now.getTime() - OPEN_GRACE_MINUTES * 60_000).toISOString(),
  };
  const { data: convs } = await supabaseAdmin
    .from("conversations")
    .select("id, lead_id, ai_status, human_takeover_at, lead_temperature, last_message_at")
    .eq("company_id", companyId)
    .gte("last_message_at", window.from)
    .lte("last_message_at", window.to)
    .order("last_message_at", { ascending: false })
    .limit(300);
  const live = ((convs ?? []) as ConversationRow[]).filter(
    (c) => c.lead_id && !c.human_takeover_at && !BLOCKING_AI_STATUS.includes(c.ai_status ?? ""),
  );
  const out: ScanResult = { candidates: [], pendingAttendance: 0 };
  if (live.length === 0) return out;

  const ctx = await loadContext(companyId, live, window);
  for (const c of live) {
    if (out.candidates.length >= limit) break;
    const r = await classify(companyId, c, ctx, {
      now,
      messageMaxAgeDays: MESSAGE_REFERENCE_MAX_AGE_DAYS,
    });
    if (r.kind === "candidate") out.candidates.push(r.candidate);
    else if (r.kind === "pending_attendance") out.pendingAttendance++;
  }
  return out;
}

/**
 * Classificação de uma conversa específica ("Follow-up agora"). Sem prazo de
 * carência: o admin está antecipando o contato de propósito.
 */
export async function classifyConversation(
  companyId: string,
  conv: ConversationRow,
  now = new Date(),
): Promise<Classification> {
  const window = {
    from: new Date(now.getTime() - REFERENCE_MAX_AGE_DAYS * 24 * 3600_000).toISOString(),
    to: now.toISOString(),
  };
  // Sem limite de idade da mensagem: o admin pediu o contato explicitamente.
  return classify(companyId, conv, await loadContext(companyId, [conv], window), { now });
}

/** Compatibilidade do barrel: só as candidatas. */
export async function findCandidates(
  companyId: string,
  settings: FollowupSettings,
  limit = 50,
): Promise<Candidate[]> {
  return (await scanFollowupOpportunities(companyId, settings, { limit })).candidates;
}
