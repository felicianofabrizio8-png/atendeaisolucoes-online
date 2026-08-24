import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { selectConversations } from "@/lib/conversation-intelligence/ConversationSelector.server";
import { findSimilarCoachLearning } from "./coach-learnings.repository";
import {
  extractHistoricalLearningDraft,
  HistoricalLearningAiError,
  type HistoricalLearningAiFailureKind,
} from "./historical-learning-extractor.server";
import {
  buildRedactedHistoricalContext,
  consolidateHistoricalCandidates,
  HISTORICAL_ANALYSIS_LIMIT,
  HISTORICAL_CANDIDATE_LIMIT,
  HISTORICAL_MAX_PAGES,
  HISTORICAL_PROMPT_VERSION,
  HISTORICAL_SCAN_LIMIT,
  hasHistoricalSpecificFacts,
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
  alreadyProcessed: number;
  rejectedSpecific: number;
  consolidated: number;
  failed: number;
  aiFailed: number;
  persistenceFailed: number;
  aiFailureBreakdown: Record<HistoricalLearningAiFailureKind, number>;
}

export async function analyzeHistoricalLearnings(args: {
  supabase: SB;
  companyId: string;
  userId: string;
}): Promise<HistoricalLearningRunResult> {
  const result: HistoricalLearningRunResult = {
    scanned: 0,
    analyzed: 0,
    created: 0,
    duplicatesSkipped: 0,
    alreadyProcessed: 0,
    rejectedSpecific: 0,
    consolidated: 0,
    failed: 0,
    aiFailed: 0,
    persistenceFailed: 0,
    aiFailureBreakdown: {
      config: 0,
      auth: 0,
      credit: 0,
      rate_limit: 0,
      timeout: 0,
      http: 0,
      format: 0,
    },
  };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: historicalVersions, error: historyError } = await supabaseAdmin
    .from("coach_learning_versions" as never)
    .select("metadata")
    .eq("company_id", args.companyId)
    .eq("origin", "system")
    .eq("prompt_version", HISTORICAL_PROMPT_VERSION)
    .limit(10_000);
  if (historyError) throw historyError;
  const processedConversationIds = new Set<string>();
  for (const row of (historicalVersions ?? []) as Array<{ metadata?: Record<string, unknown> }>) {
    const metadata = row.metadata ?? {};
    const ids = Array.isArray(metadata.evidence_conversation_ids)
      ? metadata.evidence_conversation_ids
      : [metadata.conversation_id];
    for (const id of ids) if (typeof id === "string") processedConversationIds.add(id);
  }

  const selected = [] as Awaited<ReturnType<typeof selectConversations>>;
  for (
    let page = 0;
    page < HISTORICAL_MAX_PAGES && selected.length < HISTORICAL_ANALYSIS_LIMIT;
    page += 1
  ) {
    const raw = await selectConversations({
      companyId: args.companyId,
      limit: HISTORICAL_SCAN_LIMIT,
      offset: page * HISTORICAL_SCAN_LIMIT,
      onlyTerminated: false,
      olderThanDays: 2,
    });
    result.scanned += raw.length;
    if (raw.length === 0) break;
    const fresh = raw.filter((conversation) => {
      if (!processedConversationIds.has(conversation.conversation_id)) return true;
      result.alreadyProcessed += 1;
      return false;
    });
    selected.push(
      ...selectHistoricalConversations(
        fresh,
        args.companyId,
        HISTORICAL_ANALYSIS_LIMIT - selected.length,
      ),
    );
    if (raw.length < HISTORICAL_SCAN_LIMIT) break;
  }

  const extractedCandidates: Array<{
    draft: Awaited<ReturnType<typeof extractHistoricalLearningDraft>>["draft"];
    conversationId: string;
  }> = [];
  for (const conversation of selected.slice(0, HISTORICAL_ANALYSIS_LIMIT)) {
    result.analyzed += 1;
    try {
      const context = buildRedactedHistoricalContext(conversation);
      const extracted = await extractHistoricalLearningDraft({
        companyId: args.companyId,
        userExplanation: context,
      });
      const draft = redactHistoricalDraft(extracted.draft);
      if (hasHistoricalSpecificFacts(draft)) {
        result.rejectedSpecific += 1;
        continue;
      }
      extractedCandidates.push({ draft, conversationId: conversation.conversation_id });
    } catch (error) {
      result.failed += 1;
      result.aiFailed += 1;
      const kind = error instanceof HistoricalLearningAiError ? error.kind : "http";
      result.aiFailureBreakdown[kind] += 1;
      console.warn("[historical-learning] ai_failure", {
        kind,
        status: error instanceof HistoricalLearningAiError ? error.status : null,
      });
    }
  }

  const canonicalCandidates = consolidateHistoricalCandidates(extractedCandidates);
  result.consolidated = extractedCandidates.length - canonicalCandidates.length;
  for (const candidate of canonicalCandidates.slice(0, HISTORICAL_CANDIDATE_LIMIT)) {
    const { draft, conversationIds } = candidate;
    try {
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
            conversation_id: conversationIds[0],
            evidence_conversation_ids: conversationIds,
            evidence_count: conversationIds.length,
          },
        } as never);
      if (versionError) throw versionError;
      result.created += 1;
    } catch (error) {
      result.failed += 1;
      result.persistenceFailed += 1;
    }
  }

  return result;
}
