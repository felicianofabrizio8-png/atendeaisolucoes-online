// Coach Interpreter — Repository.
// Todas as leituras usam RLS via o client autenticado do middleware.
// Escritas críticas usam a RPC atômica confirm_coach_rule_proposal.
// Server-side apenas: nunca importe deste arquivo em código de browser
// (é consumido por *.functions.ts em `.handler()`).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { CoachProposal } from "./schema";
import type { CoachInterpreterRunMeta } from "./types";

type SB = SupabaseClient<Database>;

export interface CoachConversationRow {
  id: string;
  company_id: string;
  owner_user_id: string | null;
  title: string | null;
  status: string;
  last_message_at: string | null;
  prompt_version: string | null;
  model_name: string | null;
  meta: Json;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface CoachMessageRow {
  id: string;
  conversation_id: string;
  company_id: string;
  kind: string;
  author_user_id: string | null;
  content: string;
  payload: Json;
  run: Json;
  client_request_id: string | null;
  created_at: string;
}

export interface CoachProposalRow {
  id: string;
  company_id: string;
  conversation_id: string;
  source_message_id: string;
  status: string;
  title: string;
  category: string;
  rule_type: string;
  scope_kind: string;
  scope_ref: Json;
  priority: number;
  instruction: string;
  confidence: number;
  risk_level: string;
  warnings: Json;
  normalized_output: Json;
  created_at: string;
}

// ------------------------------------------------------------------
// Feature flag / kill switch
// ------------------------------------------------------------------
export function isKillSwitchActive(): boolean {
  const v = process.env.COACH_INTERPRETER_KILLSWITCH;
  return typeof v === "string" && v.toLowerCase() === "true";
}

export async function checkCoachInterpreterEnabled(sb: SB, companyId: string): Promise<boolean> {
  if (isKillSwitchActive()) return false;
  const { data, error } = await sb
    .from("company_settings")
    .select("coach_interpreter_enabled")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(`flag_lookup_failed: ${error.message}`);
  return Boolean(data?.coach_interpreter_enabled);
}

// ------------------------------------------------------------------
// Conversations
// ------------------------------------------------------------------
export async function createCoachConversation(
  sb: SB,
  companyId: string,
  userId: string,
  title: string | null,
  promptVersion: string,
  modelName: string,
): Promise<CoachConversationRow> {
  const { data, error } = await sb
    .from("coach_conversations")
    .insert({
      company_id: companyId,
      owner_user_id: userId,
      title,
      status: "open",
      prompt_version: promptVersion,
      model_name: modelName,
    })
    .select("*")
    .single();
  if (error) throw new Error(`conversation_create_failed: ${error.message}`);
  return data as CoachConversationRow;
}

export async function listCoachConversations(sb: SB, limit = 50): Promise<CoachConversationRow[]> {
  const { data, error } = await sb
    .from("coach_conversations")
    .select("*")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(Math.min(200, Math.max(1, limit)));
  if (error) throw new Error(`conversation_list_failed: ${error.message}`);
  return (data ?? []) as CoachConversationRow[];
}

export async function getCoachConversation(
  sb: SB,
  conversationId: string,
): Promise<CoachConversationRow | null> {
  const { data, error } = await sb
    .from("coach_conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(`conversation_get_failed: ${error.message}`);
  return (data as CoachConversationRow | null) ?? null;
}

// ------------------------------------------------------------------
// Messages
// ------------------------------------------------------------------

/**
 * Fase 2.b.1 (A1/A2/M3) — reserva atômica de user_message.
 *
 * Delegamos ao RPC `coach_reserve_user_message` (SECURITY DEFINER) que faz
 * INSERT ... ON CONFLICT DO NOTHING sobre o índice único parcial. Retorna
 * `{ messageId, created }`. Duas requisições concorrentes com o mesmo
 * `client_request_id` recebem o mesmo `messageId`; apenas UMA vê
 * `created=true` e deve seguir para o LLM.
 *
 * Erros brutos de unique violation não vazam: são absorvidos pelo próprio
 * DO NOTHING.
 */
export async function reserveUserCoachMessage(
  sb: SB,
  conversationId: string,
  clientRequestId: string,
  content: string,
): Promise<{ messageId: string; created: boolean }> {
  const { data, error } = await sb.rpc(
    "coach_reserve_user_message" as never,
    {
      _conversation_id: conversationId,
      _client_request_id: clientRequestId,
      _content: content,
    } as never,
  );
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("coach_reserve_no_row");
  const r = row as { message_id: string; created: boolean };
  return { messageId: r.message_id, created: r.created };
}

// (Mantidos por completude para diagnóstico e para o retryCoachInterpretationFn.)
export async function findExistingUserMessageByClientRequestId(
  sb: SB,
  conversationId: string,
  clientRequestId: string,
): Promise<CoachMessageRow | null> {
  const { data, error } = await sb
    .from("coach_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("client_request_id", clientRequestId)
    .eq("kind", "user_message")
    .maybeSingle();
  if (error) throw new Error(`message_lookup_failed: ${error.message}`);
  return (data as CoachMessageRow | null) ?? null;
}

export async function getCoachMessageById(
  sb: SB,
  messageId: string,
): Promise<CoachMessageRow | null> {
  const { data, error } = await sb
    .from("coach_messages")
    .select("*")
    .eq("id", messageId)
    .maybeSingle();
  if (error) throw new Error(`message_get_failed: ${error.message}`);
  return (data as CoachMessageRow | null) ?? null;
}

export async function insertAssistantCoachMessage(
  sb: SB,
  companyId: string,
  conversationId: string,
  content: string,
  payload: Record<string, unknown>,
  run: CoachInterpreterRunMeta,
  kind: "assistant_message" | "clarification_request" | "error" = "assistant_message",
): Promise<CoachMessageRow> {
  const { data, error } = await sb
    .from("coach_messages")
    .insert({
      company_id: companyId,
      conversation_id: conversationId,
      kind,
      author_user_id: null,
      content,
      payload: payload as unknown as Json,
      run: run as unknown as Json,
    })
    .select("*")
    .single();
  if (error) throw new Error(`assistant_message_insert_failed: ${error.message}`);
  return data as CoachMessageRow;
}

export async function listCoachMessages(
  sb: SB,
  conversationId: string,
  limit = 100,
): Promise<CoachMessageRow[]> {
  const { data, error } = await sb
    .from("coach_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(Math.min(500, Math.max(1, limit)));
  if (error) throw new Error(`message_list_failed: ${error.message}`);
  return (data ?? []) as CoachMessageRow[];
}

// ------------------------------------------------------------------
// Proposals
// ------------------------------------------------------------------
export async function insertCoachProposals(
  sb: SB,
  companyId: string,
  conversationId: string,
  sourceMessageId: string,
  proposals: CoachProposal[],
  normalizedOutput: Record<string, unknown>,
  modelProvider: string,
  modelName: string,
  promptVersion: string,
): Promise<CoachProposalRow[]> {
  if (proposals.length === 0) return [];
  const rows = proposals.map((p) => ({
    company_id: companyId,
    conversation_id: conversationId,
    source_message_id: sourceMessageId,
    status: "pending",
    title: p.title,
    category: p.category,
    rule_type: p.rule_type,
    scope_kind: p.scope_kind,
    scope_ref: p.scope_ref as unknown as Json,
    priority: p.priority,
    condition: p.condition || null,
    instruction: p.instruction,
    rationale: p.rationale || null,
    confidence: p.confidence,
    risk_level: p.risk_level,
    ambiguities: p.ambiguities as unknown as Json,
    missing_information: p.missing_information as unknown as Json,
    warnings: [] as unknown as Json,
    normalized_output: normalizedOutput as unknown as Json,
    model_provider: modelProvider,
    model_name: modelName,
    prompt_version: promptVersion,
  }));
  const { data, error } = await sb.from("coach_rule_proposals").insert(rows).select("*");
  if (error) throw new Error(`proposal_insert_failed: ${error.message}`);
  return (data ?? []) as CoachProposalRow[];
}

export async function listCoachProposals(
  sb: SB,
  conversationId: string,
): Promise<CoachProposalRow[]> {
  const { data, error } = await sb
    .from("coach_rule_proposals")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`proposal_list_failed: ${error.message}`);
  return (data ?? []) as CoachProposalRow[];
}

export async function updateCoachProposal(
  sb: SB,
  proposalId: string,
  patch: Partial<{
    title: string;
    instruction: string;
    priority: number;
    scope_kind: string;
    scope_ref: Record<string, unknown>;
  }>,
): Promise<void> {
  const update = {
    ...patch,
    status: "edited" as const,
    updated_at: new Date().toISOString(),
  } as unknown as Database["public"]["Tables"]["coach_rule_proposals"]["Update"];
  const { error } = await sb.from("coach_rule_proposals").update(update).eq("id", proposalId);
  if (error) throw new Error(`proposal_update_failed: ${error.message}`);
}

export async function discardCoachProposal(sb: SB, proposalId: string): Promise<void> {
  const { error } = await sb
    .from("coach_rule_proposals")
    .update({ status: "discarded", discarded_at: new Date().toISOString() })
    .eq("id", proposalId);
  if (error) throw new Error(`proposal_discard_failed: ${error.message}`);
}

export async function confirmCoachProposalViaRpc(
  sb: SB,
  proposalId: string,
  overrides: Record<string, unknown>,
  criticalConfirmed: boolean,
): Promise<{ rule_id: string; version_id: string; was_already_confirmed: boolean }> {
  const { data, error } = await sb.rpc("confirm_coach_rule_proposal", {
    _proposal_id: proposalId,
    _overrides: overrides as unknown as Json,
    _critical_confirmed: criticalConfirmed,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("confirm_rpc_no_row");
  return row as { rule_id: string; version_id: string; was_already_confirmed: boolean };
}

// ------------------------------------------------------------------
// Duplicate detection — best-effort, non-blocking warning only.
// ------------------------------------------------------------------
export function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function findPotentialDuplicateRules(
  sb: SB,
  proposal: Pick<CoachProposal, "title" | "category" | "scope_kind">,
): Promise<{ ruleIds: string[]; proposalIds: string[] }> {
  const norm = normalizeTitle(proposal.title);
  if (norm.length < 3) return { ruleIds: [], proposalIds: [] };

  const [{ data: rules, error: e1 }, { data: props, error: e2 }] = await Promise.all([
    sb
      .from("coach_rules")
      .select("id, title, category, scope_kind, status")
      .eq("category", proposal.category)
      .eq("scope_kind", proposal.scope_kind)
      .in("status", ["draft", "active", "paused"])
      .limit(100),
    sb
      .from("coach_rule_proposals")
      .select("id, title, category, scope_kind, status")
      .eq("category", proposal.category)
      .eq("scope_kind", proposal.scope_kind)
      .in("status", ["pending", "edited"])
      .limit(100),
  ]);
  if (e1) throw new Error(`duplicate_lookup_failed: ${e1.message}`);
  if (e2) throw new Error(`duplicate_lookup_failed: ${e2.message}`);

  const matchRule = (t: string) => normalizeTitle(t) === norm;
  return {
    ruleIds: (rules ?? []).filter((r) => matchRule(r.title as string)).map((r) => r.id as string),
    proposalIds: (props ?? [])
      .filter((p) => matchRule(p.title as string))
      .map((p) => p.id as string),
  };
}
