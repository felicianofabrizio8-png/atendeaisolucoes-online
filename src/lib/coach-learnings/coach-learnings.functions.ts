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

// Allowlist declarativa — path/outcome NUNCA vêm do payload do cliente.
type AuditPath = "rpc:create_coach_learning";
type AuditOutcome = "error" | "ok" | "instrumentation_test";
const AUDIT_PATHS: readonly AuditPath[] = ["rpc:create_coach_learning"] as const;
const AUDIT_OUTCOMES: readonly AuditOutcome[] = ["error", "ok", "instrumentation_test"] as const;
// Referências mantidas para inspeção em testes — evita warnings de "unused".
void AUDIT_PATHS;
void AUDIT_OUTCOMES;

async function getCompanyIdSafe(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    return (data?.company_id as string | null) ?? null;
  } catch {
    return null;
  }
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

const FIELD_FOR_CODE: Record<string, "title" | "rule_structured" | "origin" | null> = {
  coach_learning_invalid_title: "title",
  coach_learning_invalid_rule: "rule_structured",
  coach_learning_invalid_origin: "origin",
  learning_duplicate_conflict: "title",
  unique_violation: "title",
};

export const createCoachLearningFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createInput.parse(data))
  .handler(async ({ data, context }) => {
    const t0 = Date.now();
    let stage: "rpc:create_coach_learning" | "rpc:submit_suggestion_feedback" = "rpc:create_coach_learning";
    try {
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
        stage = "rpc:submit_suggestion_feedback";
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
      return { ok: true as const, id, learning: { id } };
    } catch (err) {
      const norm = normalizeFailure(err);
      const logPayload = {
        stage,
        pgCode: norm.pgCode ?? null,
        code: norm.code,
        message: sanitizeText(norm.message),
        details: sanitizeText(norm.details ?? null),
        hint: sanitizeText(norm.hint ?? null),
        userId: maskId(context.userId),
        sourceConversationId: maskId(data.sourceConversationId ?? null),
        sourceSuggestionId: maskId(data.sourceSuggestionId ?? null),
        category: data.draft.category,
        priority: data.draft.priority,
        timestamp: new Date().toISOString(),
      };
      // Log server-side sem qualquer conteúdo do rascunho.
      console.error("[createCoachLearningFn] failure", logPayload);
      // Auditoria best-effort — usa cliente administrativo (bypass RLS).
      // Tenant/user vêm SEMPRE do contexto autenticado, nunca do payload do cliente.
      // Path e outcome pertencem à allowlist declarada em AUDIT_ALLOWLIST.
      try {
        const companyId = await getCompanyIdSafe(context.supabase, context.userId);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const audit = new HttpAudit(supabaseAdmin);
        const auditPath: AuditPath = "rpc:create_coach_learning";
        const auditOutcome: AuditOutcome = "error";
        const auditResult = await audit.record({
          companyId,
          userId: context.userId,
          method: "POST",
          path: auditPath,
          status: norm.code === "permission_denied" ? 403 : 500,
          durationMs: Date.now() - t0,
          outcome: auditOutcome,
          error: `${norm.pgCode ?? "-"}:${norm.code}`,
        });
        if (!auditResult.ok) {
          // Fallback observável — o console estruturado é a fonte final de diagnóstico.
          console.error("[createCoachLearningFn] audit_write_failed", {
            path: auditPath,
            outcome: auditOutcome,
            audit_code: auditResult.code,
            audit_pgCode: auditResult.pgCode ?? null,
            original_code: norm.code,
            original_pgCode: norm.pgCode ?? null,
          });
        }
      } catch (auditErr) {
        // Auditoria nunca substitui o erro principal.
        console.error("[createCoachLearningFn] audit_exception", {
          message: auditErr instanceof Error ? auditErr.message.slice(0, 200) : "unknown",
          original_code: norm.code,
        });
      }
      const field = FIELD_FOR_CODE[norm.code] ?? null;
      return {
        ok: false as const,
        code: norm.code,
        field,
        retryable: norm.retryable,
      };
    }
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
