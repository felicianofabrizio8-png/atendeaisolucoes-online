// Coach Interpreter — Server Functions (TanStack Start).
// Todas exigem requireSupabaseAuth. Nenhuma UI é criada nesta fase.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  checkCoachInterpreterEnabled,
  confirmCoachProposalViaRpc,
  createCoachConversation,
  discardCoachProposal,
  getCoachConversation,
  isKillSwitchActive,
  listCoachConversations,
  listCoachMessages,
  listCoachProposals,
  reserveUserCoachMessage,
  updateCoachProposal,
  type CoachMessageRow,
} from "./coach-interpreter.repository";
import { interpretCoachMessage } from "./coach-interpreter.service";
import { COACH_INTERPRETER_MAX_INPUT_CHARS, COACH_INTERPRETER_MODEL } from "./types";
import { COACH_INTERPRETER_PROMPT_VERSION } from "./prompt/interpreter-prompt.v1";
import { COACH_INTERPRETER_CHANNELS, COACH_INTERPRETER_SCOPES } from "./schema";

/**
 * Fase 2.b.1 (M3) — códigos estáveis expostos ao cliente para o fluxo
 * de idempotência. Nunca vazamos mensagens brutas do Postgres.
 */
export const COACH_INTERPRETER_SEND_STATUS = {
  CREATED: "created",
  DUPLICATE_IN_PROGRESS: "duplicate_in_progress",
  DUPLICATE_COMPLETED: "duplicate_completed",
  DUPLICATE_FAILED: "duplicate_failed",
} as const;
export type CoachInterpreterSendStatus =
  (typeof COACH_INTERPRETER_SEND_STATUS)[keyof typeof COACH_INTERPRETER_SEND_STATUS];

function classifyIdempotentState(
  messages: CoachMessageRow[],
  userMessageId: string,
): "in_progress" | "completed" | "failed" {
  const target = messages.find((m) => m.id === userMessageId);
  if (!target) return "in_progress";
  const later = messages.filter(
    (m) =>
      m.created_at > target.created_at &&
      (m.kind === "assistant_message" || m.kind === "clarification_request" || m.kind === "error"),
  );
  if (later.length === 0) return "in_progress";
  if (later.some((m) => m.kind === "error")) return "failed";
  return "completed";
}

class InterpreterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number = 400,
  ) {
    super(message);
  }
}

async function ensureFlagOrThrow(
  sb: Parameters<typeof checkCoachInterpreterEnabled>[0],
  companyId: string,
) {
  if (isKillSwitchActive()) {
    throw new InterpreterError("COACH_INTERPRETER_KILLED", "COACH_INTERPRETER_KILLED", 503);
  }
  const enabled = await checkCoachInterpreterEnabled(sb, companyId);
  if (!enabled) {
    throw new InterpreterError("COACH_INTERPRETER_DISABLED", "COACH_INTERPRETER_DISABLED", 403);
  }
}

async function getOwnerCompanyOrThrow(
  sb: Parameters<typeof getCoachConversation>[0],
  userId: string,
): Promise<string> {
  const { data, error } = await sb
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data?.company_id) {
    throw new InterpreterError("no_company", "no_company", 403);
  }
  return data.company_id as string;
}

async function ensureConversationAccess(
  sb: Parameters<typeof getCoachConversation>[0],
  conversationId: string,
  companyId: string,
) {
  const conv = await getCoachConversation(sb, conversationId);
  if (!conv) throw new InterpreterError("not_found", "not_found", 404);
  if (conv.company_id !== companyId)
    throw new InterpreterError("cross_tenant", "cross_tenant", 403);
  return conv;
}

// ------------------------------------------------------------------
export const createCoachConversationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        title: z.string().trim().min(1).max(120).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const companyId = await getOwnerCompanyOrThrow(context.supabase, context.userId);
    await ensureFlagOrThrow(context.supabase, companyId);
    const conv = await createCoachConversation(
      context.supabase,
      companyId,
      context.userId,
      data.title ?? null,
      COACH_INTERPRETER_PROMPT_VERSION,
      COACH_INTERPRETER_MODEL,
    );
    return { conversation: conv };
  });

export const listCoachConversationsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const companyId = await getOwnerCompanyOrThrow(context.supabase, context.userId);
    await ensureFlagOrThrow(context.supabase, companyId);
    const rows = await listCoachConversations(context.supabase, 50);
    return { conversations: rows };
  });

export const getCoachConversationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ conversation_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getOwnerCompanyOrThrow(context.supabase, context.userId);
    await ensureFlagOrThrow(context.supabase, companyId);
    const conv = await ensureConversationAccess(context.supabase, data.conversation_id, companyId);
    const messages = await listCoachMessages(context.supabase, conv.id, 200);
    const proposals = await listCoachProposals(context.supabase, conv.id);
    return { conversation: conv, messages, proposals };
  });

export const sendCoachMessageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        conversation_id: z.string().uuid(),
        text: z.string().trim().min(1).max(COACH_INTERPRETER_MAX_INPUT_CHARS),
        client_request_id: z.string().uuid(),
        company_name: z.string().trim().max(200).optional().nullable(),
        company_tone: z.string().trim().max(200).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const companyId = await getOwnerCompanyOrThrow(context.supabase, context.userId);
    await ensureFlagOrThrow(context.supabase, companyId);
    const conv = await ensureConversationAccess(context.supabase, data.conversation_id, companyId);

    // Fase 2.b.1 (A1/M3): reserva atômica via RPC. Duas requisições
    // concorrentes com o mesmo client_request_id NUNCA disparam duas
    // chamadas ao LLM — apenas quem obteve created=true prossegue.
    const reserved = await reserveUserCoachMessage(
      context.supabase,
      conv.id,
      data.client_request_id,
      data.text,
    );

    if (!reserved.created) {
      // Perdeu o conflict: retorna estado idempotente estável, sem chamar LLM.
      const messages = await listCoachMessages(context.supabase, conv.id, 200);
      const proposals = await listCoachProposals(context.supabase, conv.id);
      const state = classifyIdempotentState(messages, reserved.messageId);
      const statusMap: Record<
        ReturnType<typeof classifyIdempotentState>,
        CoachInterpreterSendStatus
      > = {
        in_progress: COACH_INTERPRETER_SEND_STATUS.DUPLICATE_IN_PROGRESS,
        completed: COACH_INTERPRETER_SEND_STATUS.DUPLICATE_COMPLETED,
        failed: COACH_INTERPRETER_SEND_STATUS.DUPLICATE_FAILED,
      };
      return {
        status: statusMap[state],
        idempotent: true,
        user_message_id: reserved.messageId,
        messages,
        proposals,
      };
    }

    const result = await interpretCoachMessage({
      supabase: context.supabase,
      companyId,
      conversationId: conv.id,
      userMessageId: reserved.messageId,
      userMessageText: data.text,
      companyName: data.company_name ?? null,
      companyTone: data.company_tone ?? null,
    });

    const messages = await listCoachMessages(context.supabase, conv.id, 200);
    const proposals = await listCoachProposals(context.supabase, conv.id);
    return {
      status: COACH_INTERPRETER_SEND_STATUS.CREATED,
      idempotent: false,
      user_message_id: reserved.messageId,
      outcome: result.outcome,
      run: result.run,
      messages,
      proposals,
    };
  });

export const retryCoachInterpretationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        conversation_id: z.string().uuid(),
        user_message_id: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const companyId = await getOwnerCompanyOrThrow(context.supabase, context.userId);
    await ensureFlagOrThrow(context.supabase, companyId);
    const conv = await ensureConversationAccess(context.supabase, data.conversation_id, companyId);

    const msgs = await listCoachMessages(context.supabase, conv.id, 500);
    const target = msgs.find((m) => m.id === data.user_message_id && m.kind === "user_message");
    if (!target) throw new InterpreterError("not_found", "not_found", 404);

    const result = await interpretCoachMessage({
      supabase: context.supabase,
      companyId,
      conversationId: conv.id,
      userMessageId: target.id,
      userMessageText: target.content,
    });
    return { outcome: result.outcome, run: result.run };
  });

export const listCoachProposalsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ conversation_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getOwnerCompanyOrThrow(context.supabase, context.userId);
    await ensureFlagOrThrow(context.supabase, companyId);
    await ensureConversationAccess(context.supabase, data.conversation_id, companyId);
    const rows = await listCoachProposals(context.supabase, data.conversation_id);
    return { proposals: rows };
  });

export const updateCoachProposalFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        proposal_id: z.string().uuid(),
        title: z.string().trim().min(3).max(120).optional(),
        instruction: z.string().trim().min(3).max(2000).optional(),
        priority: z.number().int().min(0).max(100).optional(),
        scope_kind: z.enum(COACH_INTERPRETER_SCOPES).optional(),
        scope_ref: z.object({ channel: z.enum(COACH_INTERPRETER_CHANNELS).optional() }).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const companyId = await getOwnerCompanyOrThrow(context.supabase, context.userId);
    await ensureFlagOrThrow(context.supabase, companyId);
    const { proposal_id, ...patch } = data;
    await updateCoachProposal(context.supabase, proposal_id, patch);
    return { ok: true };
  });

export const discardCoachProposalFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ proposal_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const companyId = await getOwnerCompanyOrThrow(context.supabase, context.userId);
    await ensureFlagOrThrow(context.supabase, companyId);
    await discardCoachProposal(context.supabase, data.proposal_id);
    return { ok: true };
  });

export const confirmCoachProposalFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        proposal_id: z.string().uuid(),
        overrides: z.record(z.string(), z.unknown()).optional().default({}),
        critical_confirmed: z.boolean().optional().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const companyId = await getOwnerCompanyOrThrow(context.supabase, context.userId);
    // A RPC também valida a flag, mas checamos aqui para dar erro estável antes.
    await ensureFlagOrThrow(context.supabase, companyId);
    const out = await confirmCoachProposalViaRpc(
      context.supabase,
      data.proposal_id,
      data.overrides,
      data.critical_confirmed,
    );
    return out;
  });
