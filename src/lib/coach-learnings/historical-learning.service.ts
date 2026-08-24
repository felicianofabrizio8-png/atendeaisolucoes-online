import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { selectConversations } from "@/lib/conversation-intelligence/ConversationSelector.server";
import { findSimilarCoachLearning } from "./coach-learnings.repository";
import { extractTeachModeDraft } from "./teach-mode.service";
import {
  buildRedactedHistoricalContext,
  HISTORICAL_ANALYSIS_LIMIT,
  HISTORICAL_CANDIDATE_LIMIT,
  HISTORICAL_PROMPT_VERSION,
  HISTORICAL_SCAN_LIMIT,
  redactHistoricalDraft,
  selectHistoricalConversations,
  shouldSkipHistoricalDuplicate,
} from "./historical-learning";

type SB = SupabaseClient<Database>;

export interface HistoricalLearningRunResult {
  scanned: number;
  analyzed: number;
  created: number;
  duplicatesSkipped: number;
  failed: number;
  aiFailed: number;
  persistenceFailed: number;
}

export async function analyzeHistoricalLearnings(args: {
  supabase: SB;
  companyId: string;
  userId: string;
}): Promise<HistoricalLearningRunResult> {
  const raw = await selectConversations({
    companyId: args.companyId,
    limit: HISTORICAL_SCAN_LIMIT,
    onlyTerminated: false,
    olderThanDays: 2,
  });
  const selected = selectHistoricalConversations(raw, args.companyId);
  const result: HistoricalLearningRunResult = {
    scanned: raw.length,
    analyzed: 0,
    created: 0,
    duplicatesSkipped: 0,
    failed: 0,
    aiFailed: 0,
    persistenceFailed: 0,
  };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  for (const conversation of selected.slice(0, HISTORICAL_ANALYSIS_LIMIT)) {
    if (result.created >= HISTORICAL_CANDIDATE_LIMIT) break;
    result.analyzed += 1;
    let stage: "ai" | "persistence" = "ai";
    try {
      const context = buildRedactedHistoricalContext(conversation);
      const extracted = await extractTeachModeDraft({
        supabase: args.supabase,
        companyId: args.companyId,
        userExplanation: context,
        clientMessage: null,
        suggestionText: null,
      });
      const draft = redactHistoricalDraft(extracted.draft);
      stage = "persistence";
      const similar = await findSimilarCoachLearning(args.supabase, {
        category: draft.category,
        title: draft.title,
        rule_structured: draft.rule_structured,
        description: draft.description,
        product_ref: draft.product_ref,
        limit: 5,
      });
      if (shouldSkipHistoricalDuplicate(similar)) {
        result.duplicatesSkipped += 1;
        continue;
      }

      const { data: learning, error: learningError } = await supabaseAdmin
        .from("coach_learnings" as never)
        .insert({
          company_id: args.companyId,
          category: draft.category,
          product_ref: draft.product_ref ?? null,
          title: draft.title,
          description: draft.description,
          rule_structured: draft.rule_structured,
          positive_example: draft.positive_example ?? null,
          negative_example: draft.negative_example ?? null,
          priority: draft.priority,
          confidence: draft.confidence,
          taught_by: args.userId,
          updated_by: args.userId,
          source_conversation_id: null,
          version: 1,
          status: "paused",
        } as never)
        .select("id")
        .single();
      if (learningError || !learning) {
        if ((learningError as { code?: string } | null)?.code === "23505") {
          result.duplicatesSkipped += 1;
          continue;
        }
        throw learningError ?? new Error("historical_learning_insert_failed");
      }

      const learningId = (learning as { id: string }).id;
      const { error: versionError } = await supabaseAdmin
        .from("coach_learning_versions" as never)
        .insert({
          learning_id: learningId,
          company_id: args.companyId,
          version: 1,
          category: draft.category,
          product_ref: draft.product_ref ?? null,
          title: draft.title,
          description: draft.description,
          rule_structured: draft.rule_structured,
          positive_example: draft.positive_example ?? null,
          negative_example: draft.negative_example ?? null,
          priority: draft.priority,
          status: "paused",
          confidence: draft.confidence,
          edited_by: args.userId,
          origin: "system",
          change_reason: "Candidato extraido do historico; aguardando aprovacao humana.",
          prompt_version: HISTORICAL_PROMPT_VERSION,
          metadata: {
            source: "historical_conversation",
            conversation_id: conversation.conversation_id,
            lead_status: conversation.lead_status,
            quote_count: conversation.quote_count,
          },
        } as never);
      if (versionError) throw versionError;
      result.created += 1;
    } catch {
      result.failed += 1;
      if (stage === "ai") result.aiFailed += 1;
      else result.persistenceFailed += 1;
    }
  }

  return result;
}
