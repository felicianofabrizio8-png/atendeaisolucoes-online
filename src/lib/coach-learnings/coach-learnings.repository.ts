// Coach Learnings — Repository. Server-side only.
// Todas as leituras/escritas passam por RLS via client autenticado.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  CoachLearningDraft,
  CoachLearningRow,
  CoachLearningVersionOrigin,
  CoachLearningVersionRow,
} from "./schema";
import type { SimilarCandidate } from "./similarity";

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

/**
 * Learnings ativos, top-priority, para grounding.
 * BLOCO 4: default reduzido para 5; máximo 10 (via clampGroundingLimit).
 */
export async function listActiveLearningsForGrounding(
  sb: SB,
  companyId: string,
  limit = 5,
): Promise<CoachLearningRow[]> {
  const safeLimit = Math.min(10, Math.max(1, limit));
  const { data, error } = await sb
    .from("coach_learnings" as never)
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("priority", { ascending: false })
    .order("usage_count", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(safeLimit);
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

export interface CreateCoachLearningExtras {
  origin?: CoachLearningVersionOrigin;
  promptVersion?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Erro estruturado do repositório — preserva `code`, `pgCode`, `details` e
 * `hint` originais do PostgrestError para o serverFn logar/mapear.
 * Nunca inclui payload do rascunho.
 */
export class CoachLearningRepoError extends Error {
  readonly code: string;
  readonly pgCode?: string;
  readonly details?: string;
  readonly hint?: string;
  constructor(init: { code: string; message: string; pgCode?: string; details?: string; hint?: string }) {
    super(init.message);
    this.name = "CoachLearningRepoError";
    this.code = init.code;
    this.pgCode = init.pgCode;
    this.details = init.details;
    this.hint = init.hint;
  }
}

const KNOWN_DOMAIN_CODES = new Set([
  "coach_learning_no_company",
  "coach_learning_invalid_title",
  "coach_learning_invalid_rule",
  "coach_learning_invalid_origin",
  "learning_duplicate_conflict",
  "invalid_source_conversation",
  "no_company",
]);

function toRepoError(err: unknown): CoachLearningRepoError {
  const raw = (err ?? {}) as {
    message?: unknown;
    code?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  const message = typeof raw.message === "string" ? raw.message : "internal";
  const pgCode = typeof raw.code === "string" ? raw.code : undefined;
  const details = typeof raw.details === "string" ? raw.details : undefined;
  const hint = typeof raw.hint === "string" ? raw.hint : undefined;

  // 1) RAISE EXCEPTION 'foo' chega com message == 'foo'.
  const trimmed = message.trim();
  let code: string = "internal";
  if (KNOWN_DOMAIN_CODES.has(trimmed)) {
    code = trimmed;
  } else if (pgCode === "23505") code = "unique_violation";
  else if (pgCode === "23503") {
    code = message.includes("source_conversation") ? "invalid_source_conversation" : "foreign_key_violation";
  } else if (pgCode === "23514") code = "check_violation";
  else if (pgCode === "42501" || pgCode === "PGRST301") code = "permission_denied";
  else if (pgCode === "PGRST116") code = "not_found";
  else if (message.toLowerCase().includes("failed to fetch")) code = "network";
  else code = "internal";

  return new CoachLearningRepoError({ code, message: trimmed || "internal", pgCode, details, hint });
}

export async function createCoachLearning(
  sb: SB,
  draft: CoachLearningDraft,
  sourceConversationId: string | null,
  extras: CreateCoachLearningExtras = {},
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
    _origin: extras.origin ?? "teach_mode",
    _prompt_version: extras.promptVersion ?? null,
    _metadata: extras.metadata ?? {},
  } as never);
  if (error) throw toRepoError(error);
  return data as unknown as string;
}


export interface UpdateCoachLearningExtras {
  origin?: CoachLearningVersionOrigin;
  changeReason?: string | null;
  promptVersion?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * BLOCO 4: `expectedVersion` obrigatório para concorrência otimista.
 * O RPC compara com a versão atual; se divergir, retorna `learning_version_conflict`.
 */
export async function updateCoachLearningRpc(
  sb: SB,
  id: string,
  expectedVersion: number,
  patch: Partial<CoachLearningDraft> & { status?: string },
  extras: UpdateCoachLearningExtras = {},
): Promise<number> {
  const { data, error } = await sb.rpc("update_coach_learning" as never, {
    _learning_id: id,
    _expected_version: expectedVersion,
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
    _origin: extras.origin ?? "manual_edit",
    _change_reason: extras.changeReason ?? null,
    _prompt_version: extras.promptVersion ?? null,
    _metadata: extras.metadata ?? {},
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

/**
 * BLOCO 4: detecta aprendizados duplicados ou semelhantes dentro da mesma
 * empresa. `company_id` é resolvido no banco via `current_company_id()`.
 * O caller nunca envia company_id.
 */
export interface FindSimilarInput {
  category: string;
  title: string;
  rule_structured: string;
  description?: string | null;
  product_ref?: string | null;
  limit?: number;
}

export async function findSimilarCoachLearning(
  sb: SB,
  input: FindSimilarInput,
): Promise<SimilarCandidate[]> {
  const { data, error } = await sb.rpc("find_similar_coach_learning" as never, {
    _category: input.category,
    _title: input.title,
    _rule_structured: input.rule_structured,
    _description: input.description ?? null,
    _product_ref: input.product_ref ?? null,
    _limit: Math.min(10, Math.max(1, input.limit ?? 5)),
  } as never);
  if (error) return [];
  return ((data ?? []) as unknown) as SimilarCandidate[];
}

/**
 * BLOCO 4: restaura uma versão anterior criando NOVA versão. Preserva
 * histórico integralmente. Concorrência otimista via `expectedVersion`.
 */
export async function restoreCoachLearningVersion(
  sb: SB,
  learningId: string,
  targetVersion: number,
  expectedVersion: number,
  changeReason?: string | null,
): Promise<number> {
  const { data, error } = await sb.rpc("restore_coach_learning_version" as never, {
    _learning_id: learningId,
    _target_version: targetVersion,
    _expected_version: expectedVersion,
    _change_reason: changeReason ?? null,
  } as never);
  if (error) throw error;
  return data as unknown as number;
}

/**
 * BLOCO 4: telemetria BEST-EFFORT. Nunca lança. Idempotente por
 * `generation_ref`. Silencia qualquer falha para não afetar a sugestão.
 */
export async function recordCoachLearningRetrieval(
  sb: SB,
  ids: string[],
  generationRef: string,
  conversationId: string | null = null,
): Promise<number> {
  if (!ids.length || !generationRef) return 0;
  try {
    const { data } = await sb.rpc("record_coach_learning_retrieval" as never, {
      _ids: ids,
      _generation_ref: generationRef,
      _conversation_id: conversationId,
    } as never);
    return (data as unknown as number) ?? 0;
  } catch {
    return 0;
  }
}
