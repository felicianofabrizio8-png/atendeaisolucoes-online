// ============================================================================
// Persistência das tentativas de recuperação (Fase 6.3) — SERVER ONLY.
//
// SEGURANÇA
//  · `companyId` vem sempre de `profiles.company_id` do usuário autenticado.
//    Nenhum companyId de payload é aceito em nenhum ponto.
//  · Toda leitura e escrita filtra por `company_id`.
//  · Textos persistidos e logados passam por mascaramento.
//
// CONCORRÊNCIA
//  · Uma única tentativa ativa por conversa (índice único parcial no banco).
//  · Transições usam compare-and-set (`.eq("status", from)`): duas abas ou um
//    duplo clique só conseguem UMA transição vencedora.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { redactSensitive, sanitizeForLog } from "@/lib/recovery-ai/redact";
import {
  ACTIVE_STATUSES,
  MAX_RECOVERY_MESSAGE_CHARS,
  assertTransition,
  draftIdempotencyKey,
  type RecoveryAttempt,
  type RecoveryAttemptEvent,
  type RecoveryAttemptStatus,
  type RecoveryEventType,
} from "@/lib/recovery-exec";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;

export interface AuthContext {
  userId: string;
  companyId: string;
}

/** Autentica o Bearer e deriva a empresa no servidor. */
export async function resolveAuthContext(
  request: Request,
): Promise<AuthContext | { error: string; status: 401 | 403 }> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return { error: "não autenticado", status: 401 };

  const { data: userRes } = await supabaseAdmin.auth.getUser(token);
  if (!userRes?.user) return { error: "sessão inválida", status: 401 };

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("company_id")
    .eq("id", userRes.user.id)
    .maybeSingle();
  const companyId = (profile as Row)?.company_id as string | undefined;
  if (!companyId) return { error: "perfil sem empresa", status: 403 };

  return { userId: userRes.user.id, companyId };
}

export function mapAttempt(row: Row): RecoveryAttempt {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    leadId: row.lead_id,
    status: row.status as RecoveryAttemptStatus,
    score: row.recovery_score ?? null,
    chance: row.recovery_chance ?? null,
    tier: row.recovery_tier ?? null,
    strategyFingerprint: row.strategy_fingerprint ?? null,
    messageStyle: row.selected_message_style ?? null,
    messageText: row.selected_message_text ?? null,
    templateId: row.template_id ?? null,
    templateName: row.template_name ?? null,
    templateVariables: (row.template_variables ?? {}) as Record<string, string>,
    windowState: row.window_state ?? null,
    initiatedBy: row.initiated_by ?? null,
    initiatedAt: row.initiated_at,
    confirmedAt: row.confirmed_at ?? null,
    sentAt: row.sent_at ?? null,
    messageId: row.message_id ?? null,
    deliveryStatus: row.delivery_status ?? null,
    responseStatus: row.response_status ?? null,
    repliedAt: row.replied_at ?? null,
    outcome: row.outcome ?? null,
    outcomeAt: row.outcome_at ?? null,
    failureCode: row.failure_code ?? null,
    failureMessage: row.failure_message ?? null,
    sendAttempts: row.send_attempts ?? 0,
    source: row.source ?? "recovery_queue",
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Sanitiza e limita o texto antes de persistir. */
export function safeMessageText(input: unknown): string {
  const raw = typeof input === "string" ? input : "";
  return redactSensitive(raw.trim()).slice(0, MAX_RECOVERY_MESSAGE_CHARS);
}

export async function findActiveAttempt(
  companyId: string,
  conversationId: string,
): Promise<RecoveryAttempt | null> {
  const { data } = await supabaseAdmin
    .from("recovery_attempts")
    .select("*")
    .eq("company_id", companyId)
    .eq("conversation_id", conversationId)
    .in("status", ACTIVE_STATUSES)
    .maybeSingle();
  return data ? mapAttempt(data) : null;
}

export async function findLatestAttempt(
  companyId: string,
  conversationId: string,
): Promise<RecoveryAttempt | null> {
  const { data } = await supabaseAdmin
    .from("recovery_attempts")
    .select("*")
    .eq("company_id", companyId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = ((data ?? []) as Row[])[0];
  return row ? mapAttempt(row) : null;
}

export async function getAttempt(
  companyId: string,
  attemptId: string,
): Promise<RecoveryAttempt | null> {
  const { data } = await supabaseAdmin
    .from("recovery_attempts")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", attemptId)
    .maybeSingle();
  return data ? mapAttempt(data) : null;
}

export interface CreateAttemptInput {
  companyId: string;
  userId: string;
  conversationId: string;
  leadId: string;
  score: number | null;
  chance: number | null;
  tier: string | null;
  windowState: string | null;
  strategyFingerprint: string | null;
  planSnapshot: Record<string, unknown>;
  source?: string;
}

export async function createAttempt(
  input: CreateAttemptInput,
): Promise<{ attempt: RecoveryAttempt } | { conflict: RecoveryAttempt } | { error: string }> {
  const nowMs = Date.now();
  const { data, error } = await supabaseAdmin
    .from("recovery_attempts")
    .insert({
      company_id: input.companyId,
      conversation_id: input.conversationId,
      lead_id: input.leadId,
      status: "draft",
      recovery_score: input.score,
      recovery_chance: input.chance,
      recovery_tier: input.tier,
      window_state: input.windowState,
      strategy_fingerprint: input.strategyFingerprint,
      recovery_plan_snapshot: input.planSnapshot as Row,
      initiated_by: input.userId,
      source: input.source ?? "recovery_queue",
      idempotency_key: draftIdempotencyKey(input.conversationId, nowMs),
    })
    .select("*")
    .single();

  if (error) {
    // Índice único parcial: já existe tentativa ativa nesta conversa.
    const existing = await findActiveAttempt(input.companyId, input.conversationId);
    if (existing) return { conflict: existing };
    console.error("[recovery/exec] create attempt failed", sanitizeForLog(error.message ?? ""));
    return { error: "não foi possível iniciar a recuperação" };
  }
  return { attempt: mapAttempt(data) };
}

/**
 * Compare-and-set de estado. Só grava se a linha ainda estiver em `from` — é
 * o que garante um único vencedor entre abas/cliques concorrentes.
 */
export async function transitionAttempt(
  companyId: string,
  attemptId: string,
  from: RecoveryAttemptStatus,
  to: RecoveryAttemptStatus,
  patch: Record<string, unknown> = {},
): Promise<{ ok: true; attempt: RecoveryAttempt } | { ok: false; reason: string }> {
  const guard = assertTransition(from, to);
  if (!guard.ok) return { ok: false, reason: guard.reason };

  const { data } = await supabaseAdmin
    .from("recovery_attempts")
    .update({ status: to, ...patch } as Row)
    .eq("company_id", companyId)
    .eq("id", attemptId)
    .eq("status", from)
    .select("*")
    .maybeSingle();

  if (!data) return { ok: false, reason: "estado da tentativa mudou — recarregue o fluxo" };
  return { ok: true, attempt: mapAttempt(data) };
}

/** Atualização de conteúdo sem transição (edição de mensagem/template). */
export async function patchAttempt(
  companyId: string,
  attemptId: string,
  patch: Record<string, unknown>,
): Promise<RecoveryAttempt | null> {
  const { data } = await supabaseAdmin
    .from("recovery_attempts")
    .update(patch as Row)
    .eq("company_id", companyId)
    .eq("id", attemptId)
    .select("*")
    .maybeSingle();
  return data ? mapAttempt(data) : null;
}

/** Auditoria: apenas metadados seguros, nunca o texto integral. */
export async function logAttemptEvent(args: {
  companyId: string;
  attemptId: string | null;
  conversationId: string | null;
  leadId: string | null;
  userId: string | null;
  eventType: RecoveryEventType;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("recovery_attempt_events").insert({
    company_id: args.companyId,
    attempt_id: args.attemptId,
    conversation_id: args.conversationId,
    lead_id: args.leadId,
    user_id: args.userId,
    event_type: args.eventType,
    metadata: {
      ...(args.metadata ?? {}),
      user_id: args.userId,
    },
  });
  if (error) {
    console.error("[recovery/exec] audit insert failed", sanitizeForLog(error.message ?? ""));
  }
}

export async function listAttemptEvents(
  companyId: string,
  attemptId: string,
): Promise<RecoveryAttemptEvent[]> {
  const { data } = await supabaseAdmin
    .from("recovery_attempt_events")
    .select("id, attempt_id, conversation_id, event_type, metadata, created_at")
    .eq("company_id", companyId)
    .eq("attempt_id", attemptId)
    .order("created_at", { ascending: true })
    .limit(50);
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    attemptId: r.attempt_id ?? null,
    conversationId: r.conversation_id ?? null,
    eventType: r.event_type,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    createdAt: r.created_at,
  }));
}

export async function listCompanyAttempts(
  companyId: string,
  limit = 200,
): Promise<RecoveryAttempt[]> {
  const { data } = await supabaseAdmin
    .from("recovery_attempts")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Row[]).map(mapAttempt);
}
