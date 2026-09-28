// ============================================================================
// followup/cycles.ts
// Responsabilidade: ciclo de negociação do follow-up — abrir, agendar a
// próxima tentativa, aplicar o resultado do envio e encerrar.
//
// Um ciclo acompanha UMA referência sem resposta (orçamento, visita ou
// mensagem nossa). Encerra por: resposta do cliente (também pelo trigger em
// `messages`), venda fechada/perdida, humano assumiu, desinteresse, fim das
// tentativas ou falhas repetidas. O envio é sempre do `dispatch.ts`.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { nextBusinessSlot, type BusinessCalendar } from "./calendar";
import type { DispatchResult, SkipCode } from "./dispatch";
import {
  computeNextFollowupAt,
  hasTemporalHint,
  maxAttemptsFor,
  parseClientDeadline,
  type CycleReason,
  type ScheduleSource,
} from "./next-contact";
import { suggestNextContactDate } from "./next-contact-ai";
import type { Candidate, FollowupSettings } from "./types";

export type CloseReason =
  | "client_replied"
  | "sale_closed"
  | "sale_lost"
  | "max_attempts"
  | "human_takeover"
  | "disinterest"
  | "conversation_missing"
  | "send_failed"
  | "template_missing"
  | "superseded";

export interface CycleRow {
  id: string;
  company_id: string;
  conversation_id: string;
  lead_id: string;
  reason: CycleReason;
  reference_key: string;
  reference_at: string;
  state: "active" | "closed";
  attempts: number;
  max_attempts: number;
  next_followup_at: string | null;
  schedule_source: ScheduleSource;
  last_contact_at: string | null;
  failures: number;
  metadata: Record<string, unknown>;
}

export interface CycleContext {
  settings: FollowupSettings;
  calendar: BusinessCalendar;
  jitterMinutes: number;
  now: Date;
}

/** Falhas de envio seguidas antes de desistir do ciclo. */
export const MAX_SEND_FAILURES = 3;
/** Espera após falha de envio / template ausente / IA ocupada. */
const RETRY_AFTER_FAILURE_MIN = 60;
const RETRY_AFTER_TEMPLATE_MIN = 24 * 60;
const RETRY_AFTER_AI_BUSY_MIN = 15;
/** Mensagem nossa até isso depois do último follow-up é o próprio follow-up. */
const OWN_MESSAGE_TOLERANCE_MS = 60_000;

const SKIP_TO_CLOSE: Record<Exclude<SkipCode, "ai_busy">, CloseReason> = {
  client_replied: "client_replied",
  sale_closed: "sale_closed",
  sale_lost: "sale_lost",
  human_takeover: "human_takeover",
  disinterest: "disinterest",
  conversation_missing: "conversation_missing",
};

/**
 * Prazo pedido pelo cliente (parser determinístico) ou, se ele falou de
 * tempo de um jeito que o parser não resolve, sugestão validada da IA.
 */
async function resolveDeadline(
  companyId: string,
  c: Candidate,
  ctx: CycleContext,
): Promise<{ date: Date; source: "client_deadline" | "ai_suggestion"; evidence?: string } | null> {
  const since = new Date(Date.parse(c.referenceAt) - 7 * 24 * 3600_000).toISOString();
  const { data } = await supabaseAdmin
    .from("messages")
    .select("role, text, at")
    .eq("company_id", companyId)
    .eq("conversation_id", c.conversationId)
    .in("role", ["lead", "agent"])
    .gte("at", since)
    .lte("at", c.referenceAt)
    .order("at", { ascending: false })
    .limit(12);
  const msgs = ((data ?? []) as Array<{ role: "lead" | "agent"; text: string | null; at: string }>)
    .filter((m) => m.text)
    .map((m) => ({ role: m.role, text: m.text as string, at: m.at }));

  for (const m of msgs) {
    if (m.role !== "lead") continue;
    const hit = parseClientDeadline(m.text, new Date(m.at), ctx.calendar.timeZone);
    if (hit) return { date: hit.date, source: "client_deadline", evidence: hit.evidence };
  }
  if (!msgs.some((m) => m.role === "lead" && hasTemporalHint(m.text))) return null;
  const ai = await suggestNextContactDate({
    companyId,
    now: ctx.now,
    timeZone: ctx.calendar.timeZone,
    messages: msgs.slice().reverse(),
  });
  return ai ? { date: ai, source: "ai_suggestion" } : null;
}

async function updateCycle(companyId: string, id: string, patch: Record<string, unknown>) {
  await supabaseAdmin
    .from("followup_cycles")
    .update({ ...patch, updated_at: new Date().toISOString() } as never)
    .eq("company_id", companyId)
    .eq("id", id);
}

export async function closeCycle(companyId: string, id: string, reason: CloseReason) {
  await updateCycle(companyId, id, {
    state: "closed",
    close_reason: reason,
    closed_at: new Date().toISOString(),
    next_followup_at: null,
  });
}

/** Abre um ciclo para a candidata. `null` se outro processo já abriu. */
export async function openCycle(
  companyId: string,
  c: Candidate & { supersedesCycleId?: string },
  ctx: CycleContext,
): Promise<CycleRow | null> {
  if (c.supersedesCycleId) await closeCycle(companyId, c.supersedesCycleId, "superseded");
  const deadline = await resolveDeadline(companyId, c, ctx);
  const reason = c.rule as CycleReason;
  const next = computeNextFollowupAt({
    reason,
    attemptsDone: 0,
    anchor: new Date(c.referenceAt),
    now: ctx.now,
    settings: ctx.settings,
    calendar: ctx.calendar,
    jitterMinutes: ctx.jitterMinutes,
    seed: c.referenceKey,
    deadline: deadline ? { date: deadline.date, source: deadline.source } : null,
  });
  const { data, error } = await supabaseAdmin
    .from("followup_cycles")
    .insert({
      company_id: companyId,
      conversation_id: c.conversationId,
      lead_id: c.leadId,
      reason,
      reference_key: c.referenceKey,
      reference_at: c.referenceAt,
      max_attempts: maxAttemptsFor(ctx.settings),
      next_followup_at: next.at.toISOString(),
      schedule_source: next.source,
      metadata: {
        signal: c.signal,
        ...(deadline?.evidence ? { deadline_evidence: deadline.evidence } : {}),
      },
    } as never)
    .select("*")
    .single();
  // Violação de unicidade = outro tick abriu primeiro (ou a referência já teve ciclo).
  if (error || !data) return null;
  return data as unknown as CycleRow;
}

export async function dueCycles(companyId: string, now: Date, limit: number): Promise<CycleRow[]> {
  if (limit <= 0) return [];
  const { data } = await supabaseAdmin
    .from("followup_cycles")
    .select("*")
    .eq("company_id", companyId)
    .eq("state", "active")
    .lte("next_followup_at", now.toISOString())
    .order("next_followup_at", { ascending: true })
    .limit(limit);
  return (data ?? []) as unknown as CycleRow[];
}

export async function activeCycleFor(
  companyId: string,
  conversationId: string,
): Promise<CycleRow | null> {
  const { data } = await supabaseAdmin
    .from("followup_cycles")
    .select("*")
    .eq("company_id", companyId)
    .eq("conversation_id", conversationId)
    .eq("state", "active")
    .maybeSingle();
  return (data as unknown as CycleRow | null) ?? null;
}

/**
 * Alguém da equipe falou de novo com o cliente depois da última tentativa?
 * Então o relógio conta dessa mensagem — sem zerar as tentativas. Devolve a
 * nova data quando reagendou (o ciclo sai deste tick).
 */
export async function reanchorIfWeSpokeAgain(
  cycle: CycleRow,
  ctx: CycleContext,
): Promise<Date | null> {
  const since = Math.max(
    Date.parse(cycle.reference_at),
    cycle.last_contact_at ? Date.parse(cycle.last_contact_at) + OWN_MESSAGE_TOLERANCE_MS : 0,
  );
  const { data } = await supabaseAdmin
    .from("messages")
    .select("at")
    .eq("company_id", cycle.company_id)
    .eq("conversation_id", cycle.conversation_id)
    .eq("role", "agent")
    .gt("at", new Date(since + 1000).toISOString())
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const at = (data as { at?: string } | null)?.at;
  if (!at || Date.parse(at) <= since + 1000) return null;
  const next = computeNextFollowupAt({
    reason: cycle.reason,
    attemptsDone: Math.max(cycle.attempts, 0),
    anchor: new Date(at),
    now: ctx.now,
    settings: ctx.settings,
    calendar: ctx.calendar,
    jitterMinutes: ctx.jitterMinutes,
    seed: `${cycle.reference_key}:${at}`,
  });
  if (next.at.getTime() <= ctx.now.getTime()) return null;
  await updateCycle(cycle.company_id, cycle.id, {
    next_followup_at: next.at.toISOString(),
    schedule_source: next.source,
  });
  return next.at;
}

export interface OutcomeApplied {
  state: "active" | "closed";
  closeReason?: CloseReason;
  nextFollowupAt?: string | null;
}

/** Aplica ao ciclo o resultado de `dispatchFollowup`. */
export async function applyDispatchOutcome(
  cycle: CycleRow,
  r: DispatchResult,
  ctx: CycleContext,
): Promise<OutcomeApplied> {
  const { company_id: companyId, id } = cycle;
  /** Primeiro horário útil depois de `minutes`. */
  const at = (minutes: number) =>
    nextBusinessSlot(new Date(ctx.now.getTime() + minutes * 60_000), ctx.calendar);

  if (r.status === "sent" || r.status === "simulated") {
    const attempts = cycle.attempts + 1;
    if (attempts >= cycle.max_attempts) {
      await updateCycle(companyId, id, {
        attempts,
        failures: 0,
        last_contact_at: ctx.now.toISOString(),
        state: "closed",
        close_reason: "max_attempts",
        closed_at: ctx.now.toISOString(),
        next_followup_at: null,
      });
      return { state: "closed", closeReason: "max_attempts", nextFollowupAt: null };
    }
    const next = computeNextFollowupAt({
      reason: cycle.reason,
      attemptsDone: attempts,
      anchor: ctx.now,
      now: ctx.now,
      settings: ctx.settings,
      calendar: ctx.calendar,
      jitterMinutes: ctx.jitterMinutes,
      seed: cycle.reference_key,
    });
    await updateCycle(companyId, id, {
      attempts,
      failures: 0,
      last_contact_at: ctx.now.toISOString(),
      next_followup_at: next.at.toISOString(),
      schedule_source: next.source,
    });
    return { state: "active", nextFollowupAt: next.at.toISOString() };
  }

  if (r.status === "skipped") {
    if (r.skipCode === "ai_busy" || !r.skipCode) {
      const next = at(RETRY_AFTER_AI_BUSY_MIN).toISOString();
      await updateCycle(companyId, id, { next_followup_at: next });
      return { state: "active", nextFollowupAt: next };
    }
    const reason = SKIP_TO_CLOSE[r.skipCode];
    await closeCycle(companyId, id, reason);
    return { state: "closed", closeReason: reason, nextFollowupAt: null };
  }

  // failed | blocked: tenta de novo mais tarde, até desistir.
  const failures = cycle.failures + 1;
  const giveUp: CloseReason = r.status === "blocked" ? "template_missing" : "send_failed";
  if (failures >= MAX_SEND_FAILURES) {
    await updateCycle(companyId, id, {
      failures,
      state: "closed",
      close_reason: giveUp,
      closed_at: ctx.now.toISOString(),
      next_followup_at: null,
    });
    return { state: "closed", closeReason: giveUp, nextFollowupAt: null };
  }
  const next = at(
    r.status === "blocked" ? RETRY_AFTER_TEMPLATE_MIN : RETRY_AFTER_FAILURE_MIN,
  ).toISOString();
  await updateCycle(companyId, id, { failures, next_followup_at: next });
  return { state: "active", nextFollowupAt: next };
}
