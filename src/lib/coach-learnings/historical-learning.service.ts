import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { selectConversations } from "@/lib/conversation-intelligence/ConversationSelector.server";
import { findSimilarCoachLearning } from "./coach-learnings.repository";
import { extractHistoricalLearningDraft, HistoricalLearningAiError, type HistoricalLearningAiFailureKind } from "./historical-learning-extractor.server";
import {
  buildRedactedHistoricalContext,
  HISTORICAL_CANDIDATE_LIMIT, HISTORICAL_PROMPT_VERSION, HISTORICAL_SCAN_LIMIT,
  hasHistoricalSpecificFacts, mergeHistoricalCandidateBatches, redactHistoricalDraft,
  selectHistoricalConversations, selectMostRecurrentHistoricalCandidates,
  type HistoricalCanonicalCandidate,
} from "./historical-learning";
import type { CoachLearningDraft } from "./schema";

type SB = SupabaseClient<Database>;
interface HistoricalCheckpoint {
  nextOffset: number;
  status: "running" | "completed";
  candidates: HistoricalCanonicalCandidate[];
}

export interface HistoricalLearningRunResult {
  scanned: number;
  analyzed: number;
  created: number;
  updatedCanonical: number;
  duplicatesSkipped: number;
  alreadyProcessed: number;
  rejectedSpecific: number;
  consolidated: number;
  failed: number;
  aiFailed: number;
  persistenceFailed: number;
  checkpointOffset: number;
  checkpointCompleted: boolean;
  aiFailureBreakdown: Record<HistoricalLearningAiFailureKind, number>;
}

function emptyResult(): HistoricalLearningRunResult {
  return {
    scanned: 0, analyzed: 0, created: 0, updatedCanonical: 0,
    duplicatesSkipped: 0, alreadyProcessed: 0, rejectedSpecific: 0,
    consolidated: 0, failed: 0, aiFailed: 0, persistenceFailed: 0,
    checkpointOffset: 0, checkpointCompleted: false,
    aiFailureBreakdown: { config: 0, auth: 0, credit: 0, rate_limit: 0, timeout: 0, http: 0, format: 0 },
  };
}

function parseCheckpoint(row: unknown): HistoricalCheckpoint {
  const value = row as { next_offset?: unknown; status?: unknown; metadata?: { candidates?: unknown } } | null;
  return {
    nextOffset: typeof value?.next_offset === "number" && value.next_offset >= 0 ? value.next_offset : 0,
    status: value?.status === "completed" ? "completed" : "running",
    candidates: Array.isArray(value?.metadata?.candidates)
      ? (value.metadata.candidates as HistoricalCanonicalCandidate[])
      : [],
  };
}

async function saveCheckpoint(
  supabaseAdmin: SB,
  companyId: string,
  checkpoint: HistoricalCheckpoint,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("coach_historical_learning_checkpoints" as never)
    .upsert({
      company_id: companyId,
      prompt_version: HISTORICAL_PROMPT_VERSION,
      next_offset: checkpoint.nextOffset,
      status: checkpoint.status,
      metadata: { candidates: checkpoint.candidates },
      updated_at: new Date().toISOString(),
    } as never, { onConflict: "company_id,prompt_version" });
  if (error) throw error;
}

function uniqueEvidence(...groups: string[][]): string[] {
  return [...new Set(groups.flat().filter(Boolean))];
}

async function mergePausedCanonical(args: {
  supabaseAdmin: SB;
  companyId: string;
  userId: string;
  learningId: string;
  draft: CoachLearningDraft;
  conversationIds: string[];
}): Promise<boolean> {
  const { data: learning } = await args.supabaseAdmin
    .from("coach_learnings" as never)
    .select("*")
    .eq("id", args.learningId)
    .eq("company_id", args.companyId)
    .eq("status", "paused")
    .maybeSingle();
  if (!learning) return false;
  const row = learning as unknown as CoachLearningDraft & {
    id: string; version: number; status: string;
  };
  const { data: previousVersion } = await args.supabaseAdmin
    .from("coach_learning_versions" as never)
    .select("origin, prompt_version, metadata")
    .eq("learning_id", row.id)
    .eq("company_id", args.companyId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const previous = previousVersion as unknown as {
    origin?: string; prompt_version?: string | null; metadata?: Record<string, unknown>;
  } | null;
  if (
    previous?.origin !== "system" ||
    previous.prompt_version !== HISTORICAL_PROMPT_VERSION ||
    previous.metadata?.source !== "historical_conversation"
  ) return false;

  const oldIds = Array.isArray(previous.metadata.evidence_conversation_ids)
    ? previous.metadata.evidence_conversation_ids.filter((id): id is string => typeof id === "string")
    : [];
  const evidence = uniqueEvidence(oldIds, args.conversationIds);
  if (evidence.length === oldIds.length) return true;
  const version = row.version + 1;
  const canonical = args.draft.confidence >= row.confidence ? args.draft : row;
  const priority = Math.max(row.priority, args.draft.priority);
  const confidence = Math.max(row.confidence, args.draft.confidence);

  const { error: updateError } = await args.supabaseAdmin
    .from("coach_learnings" as never)
    .update({
      category: canonical.category, product_ref: null, title: canonical.title,
      description: canonical.description, rule_structured: canonical.rule_structured,
      positive_example: canonical.positive_example ?? null,
      negative_example: canonical.negative_example ?? null,
      priority, confidence, version, updated_by: args.userId,
    } as never)
    .eq("id", row.id)
    .eq("company_id", args.companyId)
    .eq("status", "paused");
  if (updateError) throw updateError;

  const { error: versionError } = await args.supabaseAdmin
    .from("coach_learning_versions" as never)
    .insert({
      learning_id: row.id, company_id: args.companyId, version,
      category: canonical.category, product_ref: null, title: canonical.title,
      description: canonical.description, rule_structured: canonical.rule_structured,
      positive_example: canonical.positive_example ?? null,
      negative_example: canonical.negative_example ?? null,
      priority, status: "paused", confidence, edited_by: args.userId,
      origin: "system",
      change_reason: "Novas evidências agregadas ao candidato histórico canônico.",
      prompt_version: HISTORICAL_PROMPT_VERSION,
      metadata: { source: "historical_conversation", evidence_conversation_ids: evidence, evidence_count: evidence.length },
    } as never);
  if (versionError) throw versionError;
  return true;
}

async function createPausedCanonical(args: {
  supabaseAdmin: SB;
  companyId: string;
  userId: string;
  candidate: HistoricalCanonicalCandidate;
}): Promise<void> {
  const { draft, conversationIds } = args.candidate;
  const { data: learning, error: learningError } = await args.supabaseAdmin
    .from("coach_learnings" as never)
    .insert({
      company_id: args.companyId, category: draft.category, product_ref: null,
      title: draft.title, description: draft.description,
      rule_structured: draft.rule_structured,
      positive_example: draft.positive_example ?? null,
      negative_example: draft.negative_example ?? null,
      priority: draft.priority, confidence: draft.confidence,
      taught_by: args.userId, updated_by: args.userId,
      source_conversation_id: null, version: 1, status: "paused",
    } as never)
    .select("id")
    .single();
  if (learningError || !learning) throw learningError ?? new Error("historical_learning_insert_failed");
  const learningId = (learning as { id: string }).id;
  const { error: versionError } = await args.supabaseAdmin
    .from("coach_learning_versions" as never)
    .insert({
      learning_id: learningId, company_id: args.companyId, version: 1,
      category: draft.category, product_ref: null, title: draft.title,
      description: draft.description, rule_structured: draft.rule_structured,
      positive_example: draft.positive_example ?? null,
      negative_example: draft.negative_example ?? null,
      priority: draft.priority, status: "paused", confidence: draft.confidence,
      edited_by: args.userId, origin: "system",
      change_reason: "Candidato extraído do histórico; aguardando aprovação humana.",
      prompt_version: HISTORICAL_PROMPT_VERSION,
      metadata: { source: "historical_conversation", evidence_conversation_ids: conversationIds, evidence_count: conversationIds.length },
    } as never);
  if (versionError) throw versionError;
}

export async function analyzeHistoricalLearnings(args: {
  supabase: SB;
  companyId: string;
  userId: string;
}): Promise<HistoricalLearningRunResult> {
  const result = emptyResult();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: checkpointRow, error: checkpointError } = await supabaseAdmin
    .from("coach_historical_learning_checkpoints" as never)
    .select("next_offset, status, metadata")
    .eq("company_id", args.companyId)
    .eq("prompt_version", HISTORICAL_PROMPT_VERSION)
    .maybeSingle();
  if (checkpointError) throw checkpointError;
  const checkpoint = parseCheckpoint(checkpointRow);
  result.checkpointOffset = checkpoint.nextOffset;
  if (checkpoint.status === "completed") {
    result.checkpointCompleted = true;
    return result;
  }

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
    const ids = Array.isArray(row.metadata?.evidence_conversation_ids)
      ? row.metadata.evidence_conversation_ids : [];
    for (const id of ids) if (typeof id === "string") processedConversationIds.add(id);
  }

  let offset = checkpoint.nextOffset;
  let canonicalCandidates = checkpoint.candidates;
  for (;;) {
    const raw = await selectConversations({
      companyId: args.companyId, limit: HISTORICAL_SCAN_LIMIT, offset,
      onlyTerminated: false, olderThanDays: 2,
    });
    result.scanned += raw.length;
    if (raw.length === 0) break;
    const fresh = raw.filter((conversation) => {
      if (!processedConversationIds.has(conversation.conversation_id)) return true;
      result.alreadyProcessed += 1;
      return false;
    });
    const eligible = selectHistoricalConversations(fresh, args.companyId, raw.length);
    const extracted: Array<{ draft: CoachLearningDraft; conversationId: string }> = [];
    for (const conversation of eligible) {
      result.analyzed += 1;
      try {
        const response = await extractHistoricalLearningDraft({
          companyId: args.companyId,
          userExplanation: buildRedactedHistoricalContext(conversation),
        });
        const draft = redactHistoricalDraft(response.draft);
        if (hasHistoricalSpecificFacts(draft)) {
          result.rejectedSpecific += 1;
          continue;
        }
        extracted.push({ draft, conversationId: conversation.conversation_id });
      } catch (error) {
        result.failed += 1;
        result.aiFailed += 1;
        const kind = error instanceof HistoricalLearningAiError ? error.kind : "http";
        result.aiFailureBreakdown[kind] += 1;
      }
    }
    const before = canonicalCandidates.length + extracted.length;
    canonicalCandidates = mergeHistoricalCandidateBatches(canonicalCandidates, extracted);
    result.consolidated += Math.max(0, before - canonicalCandidates.length);
    offset += raw.length;
    result.checkpointOffset = offset;
    await saveCheckpoint(supabaseAdmin, args.companyId, {
      nextOffset: offset, status: "running", candidates: canonicalCandidates,
    });
    if (raw.length < HISTORICAL_SCAN_LIMIT) break;
  }

  const recurrent = selectMostRecurrentHistoricalCandidates(
    canonicalCandidates,
    HISTORICAL_CANDIDATE_LIMIT,
  );
  for (const candidate of recurrent) {
    try {
      const similar = await findSimilarCoachLearning(args.supabase, {
        category: candidate.draft.category, title: candidate.draft.title,
        rule_structured: candidate.draft.rule_structured,
        description: candidate.draft.description, product_ref: null, limit: 5,
      });
      const related = (item: (typeof similar)[number]) =>
        ["exact", "highly_similar", "related"].includes(item.classification);
      const paused = similar.find((item) => item.status === "paused" && related(item));
      if (paused && await mergePausedCanonical({
        supabaseAdmin, companyId: args.companyId, userId: args.userId,
        learningId: paused.id, draft: candidate.draft,
        conversationIds: candidate.conversationIds,
      })) {
        result.updatedCanonical += 1;
        continue;
      }
      if (similar.some(related)) {
        result.duplicatesSkipped += 1;
        continue;
      }
      await createPausedCanonical({ supabaseAdmin, companyId: args.companyId, userId: args.userId, candidate });
      result.created += 1;
    } catch {
      result.failed += 1;
      result.persistenceFailed += 1;
    }
  }

  await saveCheckpoint(supabaseAdmin, args.companyId, {
    nextOffset: offset, status: "completed", candidates: canonicalCandidates,
  });
  result.checkpointCompleted = true;
  return result;
}
