// Coach Learnings — Repository. Server-side only.
// Todas as leituras/escritas passam por RLS via client autenticado.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  CoachLearningDraft,
  CoachLearningRow,
  CoachLearningVersionRow,
} from "./schema";

type SB = SupabaseClient<Database>;

export async function listCoachLearnings(
  sb: SB,
  opts: { includeArchived?: boolean; limit?: number } = {},
): Promise<CoachLearningRow[]> {
  const q = sb
    .from("coach_learnings" as never)
    .select("*")
    .order("priority", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(Math.min(500, opts.limit ?? 200));
  const query = opts.includeArchived
    ? q
    : (q as unknown as { in: (col: string, vals: string[]) => typeof q }).in("status", ["active", "paused"]);
  const { data, error } = await (query as unknown as PromiseLike<{ data: unknown; error: unknown }>);
  if (error) throw new Error(`coach_learnings_list_failed`);
  return (data ?? []) as CoachLearningRow[];
}

/** Learnings ativos, top-priority, para grounding. */
export async function listActiveLearningsForGrounding(
  sb: SB,
  companyId: string,
  limit = 20,
): Promise<CoachLearningRow[]> {
  const { data, error } = await sb
    .from("coach_learnings" as never)
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("priority", { ascending: false })
    .order("usage_count", { ascending: false })
    .limit(Math.min(50, Math.max(1, limit)));
  if (error) return [];
  return ((data ?? []) as unknown) as CoachLearningRow[];
}

export async function getCoachLearning(
  sb: SB,
  id: string,
): Promise<CoachLearningRow | null> {
  const { data, error } = await sb
    .from("coach_learnings" as never)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("coach_learning_get_failed");
  return (data as CoachLearningRow | null) ?? null;
}

export async function listLearningVersions(
  sb: SB,
  learningId: string,
): Promise<CoachLearningVersionRow[]> {
  const { data, error } = await sb
    .from("coach_learning_versions" as never)
    .select("*")
    .eq("learning_id", learningId)
    .order("version", { ascending: false });
  if (error) throw new Error("coach_learning_versions_list_failed");
  return ((data ?? []) as unknown) as CoachLearningVersionRow[];
}

export async function createCoachLearning(
  sb: SB,
  draft: CoachLearningDraft,
  sourceConversationId: string | null,
): Promise<string> {
  const { data, error } = await sb.rpc("create_coach_learning" as never, {
    _category: draft.category,
    _title: draft.title,
    _description: draft.description,
    _rule_structured: draft.rule_structured,
    _product_ref: draft.product_ref ?? null,
    _positive_example: draft.positive_example ?? null,
    _negative_example: draft.negative_example ?? null,
    _priority: draft.priority,
    _confidence: draft.confidence,
    _source_conversation_id: sourceConversationId,
  } as never);
  if (error) throw error;
  return data as unknown as string;
}

export async function updateCoachLearningRpc(
  sb: SB,
  id: string,
  patch: Partial<CoachLearningDraft> & { status?: string },
): Promise<number> {
  const { data, error } = await sb.rpc("update_coach_learning" as never, {
    _learning_id: id,
    _title: patch.title,
    _description: patch.description,
    _rule_structured: patch.rule_structured,
    _category: patch.category,
    _product_ref: patch.product_ref ?? null,
    _positive_example: patch.positive_example ?? null,
    _negative_example: patch.negative_example ?? null,
    _priority: patch.priority ?? null,
    _status: patch.status ?? null,
    _confidence: patch.confidence ?? null,
  } as never);
  if (error) throw error;
  return data as unknown as number;
}

export async function archiveCoachLearningRpc(sb: SB, id: string): Promise<void> {
  const { error } = await sb.rpc("archive_coach_learning" as never, {
    _learning_id: id,
  } as never);
  if (error) throw error;
}

export async function incrementLearningUsage(
  sb: SB,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await sb.rpc("increment_coach_learning_usage" as never, {
    _ids: ids,
  } as never);
  if (error) return 0;
  return (data as unknown as number) ?? 0;
}
