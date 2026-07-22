// Coach Learnings — Server Functions (TanStack Start).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  archiveCoachLearningRpc,
  createCoachLearning,
  getCoachLearning,
  incrementLearningUsage,
  listCoachLearnings,
  listLearningVersions,
  updateCoachLearningRpc,
} from "./coach-learnings.repository";
import {
  CoachLearningDraftSchema,
  COACH_LEARNING_CATEGORIES,
  COACH_LEARNING_STATUSES,
} from "./schema";
import { extractTeachModeDraft } from "./teach-mode.service";

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
});

export const createCoachLearningFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createInput.parse(data))
  .handler(async ({ data, context }) => {
    const id = await createCoachLearning(
      context.supabase,
      data.draft,
      data.sourceConversationId ?? null,
    );
    return { id };
  });

const updateInput = z.object({
  id: z.string().uuid(),
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
});

export const updateCoachLearningFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateInput.parse(data))
  .handler(async ({ data, context }) => {
    const version = await updateCoachLearningRpc(context.supabase, data.id, data.patch);
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
      });
      return {
        ok: true as const,
        draft: result.draft,
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
