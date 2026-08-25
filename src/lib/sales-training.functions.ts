import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAgentContext, runAgentTurn, runSafetyLayer } from "./ai-agent.server";
import {
  extractSessionTrainingCorrections,
  normalizeTrainingReview,
  type SessionTrainingMessage,
} from "./sales-training-domain";
import { loadValidatedProductImages } from "./sales-agent-product-images.server";
import type { AgentDecision } from "./sales-agent-core";

const SessionInput = z.object({ sessionId: z.string().uuid() });
const SendInput = SessionInput.extend({ message: z.string().trim().min(1).max(4000) });
const ReviewInput = z.object({
  messageId: z.string().uuid(),
  status: z.enum(["approved", "rejected", "corrected"]),
  correctionText: z.string().trim().min(1).max(4000).nullable().optional(),
});
const TrainingLearningInput = z.object({ messageId: z.string().uuid() });

export interface TrainingMessage {
  id: string;
  role: "lead" | "agent";
  content: string;
  review_status: "approved" | "rejected" | "corrected" | null;
  correction_text: string | null;
  promoted_learning_id: string | null;
  learning_promotion_status: "pending" | "approved" | null;
  generation_status: "pending" | "completed" | "failed";
  generation_error: "generation_failed" | null;
  decision: (AgentDecision & {
    simulated_product_images?: Array<{
      product_id: string;
      product_name: string;
      image: string;
    }>;
  }) | null;
  created_at: string;
}

async function getTenant(supabase: import("@supabase/supabase-js").SupabaseClient, userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.company_id) throw new Error("company_not_found");
  const companyId = profile.company_id as string;
  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: userId,
    _company_id: companyId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("admin_required");
  return companyId;
}

async function assertSession(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  companyId: string,
  sessionId: string,
) {
  const { data } = await supabase
    .from("ai_training_sessions" as never)
    .select("id")
    .eq("id", sessionId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!data) throw new Error("training_session_not_found");
}

export const createTrainingSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const companyId = await getTenant(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("ai_training_sessions" as never)
      .insert({ company_id: companyId, created_by: context.userId } as never)
      .select("id")
      .single();
    if (error || !data) throw new Error("training_session_create_failed");
    return { sessionId: (data as { id: string }).id };
  });

export const getTrainingSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SessionInput.parse(input))
  .handler(async ({ data: input, context }) => {
    const companyId = await getTenant(context.supabase, context.userId);
    await assertSession(context.supabase, companyId, input.sessionId);
    const { data, error } = await context.supabase
      .from("ai_training_messages" as never)
      .select(
        "id, role, content, review_status, correction_text, promoted_learning_id, learning_promotion_status, generation_status, generation_error, decision, created_at",
      )
      .eq("session_id", input.sessionId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });
    if (error) throw new Error("training_messages_load_failed");
    return { sessionId: input.sessionId, messages: (data ?? []) as unknown as TrainingMessage[] };
  });

export const sendTrainingMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SendInput.parse(input))
  .handler(async ({ data: input, context }) => {
    const companyId = await getTenant(context.supabase, context.userId);
    await assertSession(context.supabase, companyId, input.sessionId);

    const { data: leadMessage, error: leadError } = await context.supabase
      .from("ai_training_messages" as never)
      .insert({
        session_id: input.sessionId,
        company_id: companyId,
        role: "lead",
        content: input.message,
        generation_status: "pending",
      } as never)
      .select("id")
      .single();
    if (leadError || !leadMessage) throw new Error("training_message_save_failed");
    const leadMessageId = (leadMessage as { id: string }).id;

    try {
      const { data: rows, error: historyError } = await context.supabase
        .from("ai_training_messages" as never)
        .select("role, content, review_status, correction_text")
        .eq("session_id", input.sessionId)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (historyError) throw new Error("training_history_load_failed");

      const ctx = await loadAgentContext(companyId);
      if (!ctx) throw new Error("training_context_not_found");
      const sessionMessages = ((rows ?? []) as unknown as SessionTrainingMessage[]).reverse();
      const history = sessionMessages
        .slice(-40)
        .map((row) => ({ role: row.role, text: row.content }));
      const sessionCorrections = extractSessionTrainingCorrections(sessionMessages);
      const decision = runSafetyLayer(
        await runAgentTurn({ ctx, history, leadName: "Cliente simulado", sessionCorrections }),
      );
      const content =
        decision.kind === "reply" && decision.message
          ? decision.message
          : `Atendimento humano solicitado: ${decision.reason ?? "sem motivo informado"}`;
      const simulatedProductImages = (await loadValidatedProductImages(
        companyId,
        decision.product_image_ids,
        {
          history,
          detectedPoolSize: decision.detected_pool_size,
          detectedInterest: decision.detected_interest,
        },
      )).map((image) => ({
        product_id: image.productId,
        product_name: image.productName,
        image: image.storedImage,
      }));
      const trainingDecision = {
        ...decision,
        simulated_product_images: simulatedProductImages,
      };

      const { data: saved, error: agentError } = await context.supabase
        .from("ai_training_messages" as never)
        .insert({
          session_id: input.sessionId,
          company_id: companyId,
          role: "agent",
          content,
          decision: trainingDecision,
          generation_status: "completed",
        } as never)
        .select(
          "id, role, content, review_status, correction_text, promoted_learning_id, learning_promotion_status, generation_status, generation_error, decision, created_at",
        )
        .single();
      if (agentError || !saved) throw new Error("training_response_save_failed");
      await context.supabase
        .from("ai_training_messages" as never)
        .update({ generation_status: "completed", generation_error: null } as never)
        .eq("id", leadMessageId)
        .eq("company_id", companyId);
      return saved as unknown as TrainingMessage;
    } catch (error) {
      await context.supabase
        .from("ai_training_messages" as never)
        .update({ generation_status: "failed", generation_error: "generation_failed" } as never)
        .eq("id", leadMessageId)
        .eq("company_id", companyId);
      throw error;
    }
  });

export const reviewTrainingResponse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReviewInput.parse(input))
  .handler(async ({ data: input, context }) => {
    const review = normalizeTrainingReview(input);
    const companyId = await getTenant(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("ai_training_messages" as never)
      .update({
        review_status: review.status,
        correction_text: review.correctionText,
        reviewed_at: new Date().toISOString(),
        reviewed_by: context.userId,
      } as never)
      .eq("id", input.messageId)
      .eq("company_id", companyId)
      .eq("role", "agent")
      .select(
        "id, role, content, review_status, correction_text, promoted_learning_id, learning_promotion_status, generation_status, generation_error, decision, created_at",
      )
      .maybeSingle();
    if (error || !data) throw new Error("training_response_not_found");
    return data as unknown as TrainingMessage;
  });

async function promoteTrainingLearning(
  supabase: Parameters<typeof getTenant>[0],
  userId: string,
  messageId: string,
  rpc: "create_training_learning_candidate" | "approve_training_learning_candidate",
): Promise<TrainingMessage> {
  const companyId = await getTenant(supabase, userId);
  const { error } = await supabase.rpc(rpc as never, { _message_id: messageId } as never);
  if (error) throw new Error(rpc === "create_training_learning_candidate" ? "training_learning_candidate_failed" : "training_learning_approval_failed");
  const { data, error: loadError } = await supabase
    .from("ai_training_messages" as never)
    .select("id, role, content, review_status, correction_text, promoted_learning_id, learning_promotion_status, generation_status, generation_error, decision, created_at")
    .eq("id", messageId)
    .eq("company_id", companyId)
    .eq("role", "agent")
    .maybeSingle();
  if (loadError || !data) throw new Error("training_response_not_found");
  return data as unknown as TrainingMessage;
}

export const createTrainingLearningCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TrainingLearningInput.parse(input))
  .handler(({ data, context }) =>
    promoteTrainingLearning(context.supabase, context.userId, data.messageId, "create_training_learning_candidate"),
  );

export const approveTrainingLearningCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TrainingLearningInput.parse(input))
  .handler(({ data, context }) =>
    promoteTrainingLearning(context.supabase, context.userId, data.messageId, "approve_training_learning_candidate"),
  );
