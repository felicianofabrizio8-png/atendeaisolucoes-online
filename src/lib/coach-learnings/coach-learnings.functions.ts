// Coach Learnings — Server Functions (TanStack Start).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  archiveCoachLearningRpc,
  CoachLearningRepoError,
  createCoachLearning,
  findSimilarCoachLearning,
  getCoachLearning,
  incrementLearningUsage,
  listCoachLearnings,
  listLearningVersions,
  recordCoachLearningRetrieval,
  restoreCoachLearningVersion,
  updateCoachLearningRpc,
} from "./coach-learnings.repository";
import {
  CoachLearningDraftSchema,
  COACH_LEARNING_CATEGORIES,
  COACH_LEARNING_STATUSES,
  COACH_LEARNING_VERSION_ORIGINS,
} from "./schema";
import { extractTeachModeDraft } from "./teach-mode.service";
import { HttpAudit } from "@/lib/audit/HttpAudit.server";

// ---------------------------------------------------------------------------
// Helpers server-only para instrumentação sanitizada.
// Nunca gravam conteúdo do rascunho (regra, descrição, exemplos, mensagens).
// ---------------------------------------------------------------------------
function maskId(id: string | null | undefined): string | null {
  if (!id) return null;
  return `${id.slice(0, 8)}…`;
}

function sanitizeText(s: string | undefined | null, max = 240): string | null {
  if (!s) return null;
  return s
    .replace(/eyJ[a-zA-Z0-9._-]+/g, "[jwt]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d{2,3}[\s-]?\(?\d{2,3}\)?[\s-]?\d{3,5}[\s-]?\d{3,5}/g, "[phone]")
    .slice(0, max);
}

interface NormalizedRepoFailure {
  code: string;
  pgCode?: string;
  message: string;
  details?: string;
  hint?: string;
  retryable: boolean;
}

const RETRYABLE_CODES = new Set([
  "network",
  "timeout",
  "internal",
  "server_error",
  "invalid_source_conversation",
  "foreign_key_violation",
]);

function normalizeFailure(err: unknown): NormalizedRepoFailure {
  if (err instanceof CoachLearningRepoError) {
    return {
      code: err.code,
      pgCode: err.pgCode,
      message: err.message,
      details: err.details,
      hint: err.hint,
      retryable: RETRYABLE_CODES.has(err.code),
    };
  }
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "internal";
  return { code: "internal", message: msg, retryable: true };
}


const listInput = z.object({ includeArchived: z.boolean().optional() });

export const listCoachLearningsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => listInput.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    const rows = await listCoachLearnings(context.supabase, {
      includeArchived: data.includeArchived ?? false,
    });
    return { learnings: rows };
  });

const getInput = z.object({ id: z.string().uuid() });

export const getCoachLearningFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => getInput.parse(data))
  .handler(async ({ data, context }) => {
    const [row, versions] = await Promise.all([
      getCoachLearning(context.supabase, data.id),
      listLearningVersions(context.supabase, data.id),
    ]);
    if (!row) throw new Error("not_found");
    return { learning: row, versions };
  });

const createInput = z.object({
  draft: CoachLearningDraftSchema,
  sourceConversationId: z.string().uuid().nullable().optional(),
  sourceSuggestionId: z.string().uuid().nullable().optional(),
  promptVersion: z.string().max(120).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const createCoachLearningFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createInput.parse(data))
  .handler(async ({ data, context }) => {
    const id = await createCoachLearning(
      context.supabase,
      data.draft,
      data.sourceConversationId ?? null,
      {
        origin: "teach_mode",
        promptVersion: data.promptVersion ?? null,
        metadata: data.metadata ?? {},
      },
    );
    if (data.sourceSuggestionId) {
      try {
        await context.supabase.rpc(
          "submit_coach_suggestion_feedback" as never,
          {
            _suggestion_id: data.sourceSuggestionId,
            _feedback: "negative",
            _learning_id: id,
          } as never,
        );
      } catch {
        // Não bloqueia a criação do aprendizado se a sugestão sumir.
      }
    }
    return { id };
  });


const updateInput = z.object({
  id: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  patch: z
    .object({
      category: z.enum(COACH_LEARNING_CATEGORIES),
      product_ref: z.string().max(120).nullable().optional(),
      title: z.string().min(3).max(120),
      description: z.string().min(3).max(2000),
      rule_structured: z.string().min(3).max(2000),
      positive_example: z.string().max(2000).nullable().optional(),
      negative_example: z.string().max(2000).nullable().optional(),
      priority: z.number().int().min(0).max(100).optional(),
      confidence: z.number().min(0).max(1).optional(),
      status: z.enum(COACH_LEARNING_STATUSES).optional(),
    }),
  origin: z.enum(COACH_LEARNING_VERSION_ORIGINS).optional(),
  changeReason: z.string().max(500).nullable().optional(),
  promptVersion: z.string().max(120).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateCoachLearningFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateInput.parse(data))
  .handler(async ({ data, context }) => {
    const version = await updateCoachLearningRpc(
      context.supabase,
      data.id,
      data.expectedVersion,
      data.patch,
      {
        origin: data.origin ?? "manual_edit",
        changeReason: data.changeReason ?? null,
        promptVersion: data.promptVersion ?? null,
        metadata: data.metadata ?? {},
      },
    );
    return { version };
  });

const archiveInput = z.object({ id: z.string().uuid() });

export const archiveCoachLearningFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => archiveInput.parse(data))
  .handler(async ({ data, context }) => {
    await archiveCoachLearningRpc(context.supabase, data.id);
    return { ok: true as const };
  });

const teachExtractInput = z.object({
  explanation: z.string().min(3).max(4000),
  priorTurns: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      }),
    )
    .max(20)
    .optional(),
  companyName: z.string().max(200).nullable().optional(),
  clientMessage: z.string().max(4000).nullable().optional(),
  suggestionText: z.string().max(4000).nullable().optional(),
});

export const teachModeExtractFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => teachExtractInput.parse(data))
  .handler(async ({ data, context }) => {
    try {
      const { data: profile } = await context.supabase
        .from("profiles")
        .select("company_id")
        .eq("id", context.userId)
        .maybeSingle();
      const companyId = (profile?.company_id as string | null) ?? "";
      if (!companyId) return { ok: false as const, error: "no_company" };
      const result = await extractTeachModeDraft({
        supabase: context.supabase,
        companyId,
        companyName: data.companyName ?? null,
        userExplanation: data.explanation,
        priorTurns: data.priorTurns,
        clientMessage: data.clientMessage ?? null,
        suggestionText: data.suggestionText ?? null,
      });
      return {
        ok: true as const,
        draft: result.draft,
        usedFallback: result.usedFallback,
        meta: {
          provider: result.provider,
          model: result.model,
          tokens_in: result.tokensIn,
          tokens_out: result.tokensOut,
          latency_ms: result.latencyMs,
          prompt_version: result.promptVersion,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "extract_failed";
      return { ok: false as const, error: message };
    }
  });

const feedbackInput = z.object({
  learningIds: z.array(z.string().uuid()).max(20),
});

/** Registra uso positivo — botão 👍 confirma que os learnings foram úteis. */
export const submitLearningFeedbackFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => feedbackInput.parse(data))
  .handler(async ({ data, context }) => {
    const count = await incrementLearningUsage(context.supabase, data.learningIds);
    return { incremented: count };
  });

const suggestionFeedbackInput = z.object({
  suggestionId: z.string().uuid(),
  status: z.enum(["positive", "negative"]),
  learningId: z.string().uuid().nullable().optional(),
});

export const submitSuggestionFeedbackFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => suggestionFeedbackInput.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc(
      "submit_coach_suggestion_feedback" as never,
      {
        _suggestion_id: data.suggestionId,
        _feedback: data.status,
        _learning_id: data.learningId ?? null,
      } as never,
    );
    if (error) throw new Error(error.message ?? "suggestion_feedback_failed");
    return { ok: true as const };
  });

// -------------------------------------------------------------------------
// BLOCO 4 — Similaridade, restauração, telemetria
// -------------------------------------------------------------------------

const findSimilarInput = z.object({
  category: z.enum(COACH_LEARNING_CATEGORIES),
  title: z.string().min(1).max(120),
  rule_structured: z.string().min(1).max(2000),
  description: z.string().max(2000).nullable().optional(),
  product_ref: z.string().max(120).nullable().optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

/**
 * Detecta duplicidade exata + aprendizados semelhantes na MESMA empresa.
 * A empresa é resolvida no servidor pela RPC via `current_company_id()`.
 */
export const findSimilarCoachLearningFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => findSimilarInput.parse(data))
  .handler(async ({ data, context }) => {
    const candidates = await findSimilarCoachLearning(context.supabase, data);
    return { candidates };
  });

const restoreInput = z.object({
  learningId: z.string().uuid(),
  targetVersion: z.number().int().min(1),
  expectedVersion: z.number().int().min(1),
  changeReason: z.string().max(500).nullable().optional(),
});

export const restoreCoachLearningVersionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => restoreInput.parse(data))
  .handler(async ({ data, context }) => {
    const version = await restoreCoachLearningVersion(
      context.supabase,
      data.learningId,
      data.targetVersion,
      data.expectedVersion,
      data.changeReason ?? null,
    );
    return { version };
  });

const retrievalInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(20),
  generationRef: z.string().min(3).max(160),
  conversationId: z.string().uuid().nullable().optional(),
});

/**
 * Telemetria de retrieval — best-effort. Nunca lança erro para o cliente.
 * Idempotente por (learning_id, generation_ref).
 */
export const recordCoachLearningRetrievalFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => retrievalInput.parse(data))
  .handler(async ({ data, context }) => {
    const inserted = await recordCoachLearningRetrieval(
      context.supabase,
      data.ids,
      data.generationRef,
      data.conversationId ?? null,
    );
    return { inserted };
  });
