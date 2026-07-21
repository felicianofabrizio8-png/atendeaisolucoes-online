// Repository do Coach V2 — Fase 1.
// Todas as leituras usam o client autenticado (RLS aplica).
// Todas as escritas são feitas via RPC (SECURITY DEFINER) que valida admin.
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type CoachRuleCategory = Database["public"]["Enums"]["coach_rule_category"];
export type CoachRuleType = Database["public"]["Enums"]["coach_rule_type"];
export type CoachRuleScopeKind = Database["public"]["Enums"]["coach_rule_scope_kind"];
export type CoachRuleStatus = Database["public"]["Enums"]["coach_rule_status"];
export type CoachRuleVersionStatus = Database["public"]["Enums"]["coach_rule_version_status"];
export type CoachRuleEventType = Database["public"]["Enums"]["coach_rule_event_type"];

export type CoachRuleRow = Database["public"]["Tables"]["coach_rules"]["Row"];
export type CoachRuleVersionRow = Database["public"]["Tables"]["coach_rule_versions"]["Row"];
export type CoachRuleEventRow = Database["public"]["Tables"]["coach_rule_events"]["Row"];

export const COACH_RULE_CATEGORIES: readonly CoachRuleCategory[] = [
  "identity", "tone", "qualification", "sales", "pricing", "negotiation",
  "discounts", "payments", "followup", "human_handoff", "prohibitions",
  "safety", "after_sales", "other",
] as const;

export const COACH_RULE_TYPES: readonly CoachRuleType[] = [
  "instruction", "prohibition", "mandatory_action", "mandatory_question",
  "handoff", "standard_reply", "preference",
] as const;

export const COACH_RULE_SCOPES: readonly CoachRuleScopeKind[] = ["company", "agent", "channel"] as const;

export const COACH_CHANNELS = ["whatsapp", "instagram", "facebook", "web", "other"] as const;

export const COACH_CRITICAL_CATEGORIES = new Set<CoachRuleCategory>([
  "safety", "pricing", "discounts", "payments", "prohibitions", "human_handoff",
]);

export const COACH_CATEGORY_LABEL: Record<CoachRuleCategory, string> = {
  identity: "Identidade",
  tone: "Tom de voz",
  qualification: "Qualificação",
  sales: "Vendas",
  pricing: "Preço",
  negotiation: "Negociação",
  discounts: "Descontos",
  payments: "Pagamentos",
  followup: "Follow-up",
  human_handoff: "Transferência humana",
  prohibitions: "Proibições",
  safety: "Segurança",
  after_sales: "Pós-venda",
  other: "Outros",
};

export const COACH_TYPE_LABEL: Record<CoachRuleType, string> = {
  instruction: "Instrução",
  prohibition: "Proibição",
  mandatory_action: "Ação obrigatória",
  mandatory_question: "Pergunta obrigatória",
  handoff: "Transferência",
  standard_reply: "Resposta padrão",
  preference: "Preferência",
};

export const COACH_RULE_STATUS_LABEL: Record<CoachRuleStatus, string> = {
  draft: "Rascunho",
  active: "Ativa",
  paused: "Pausada",
  archived: "Arquivada",
  replaced: "Substituída",
};

export const COACH_VERSION_STATUS_LABEL: Record<CoachRuleVersionStatus, string> = {
  draft: "Rascunho",
  pending_approval: "Aguardando aprovação",
  approved: "Aprovada",
  rejected: "Rejeitada",
  archived: "Arquivada",
};

export type CoachRuleScopeRef =
  | Record<string, never>
  | { agent_id: string }
  | { channel: (typeof COACH_CHANNELS)[number] };

// ------------------------------------------------------------------
// READS
// ------------------------------------------------------------------
export async function listCoachRules(): Promise<CoachRuleRow[]> {
  const { data, error } = await supabase
    .from("coach_rules")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getCoachRule(ruleId: string): Promise<CoachRuleRow | null> {
  const { data, error } = await supabase
    .from("coach_rules").select("*").eq("id", ruleId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listCoachRuleVersions(ruleId: string): Promise<CoachRuleVersionRow[]> {
  const { data, error } = await supabase
    .from("coach_rule_versions")
    .select("*")
    .eq("rule_id", ruleId)
    .order("version_number", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listCoachRuleEvents(ruleId: string): Promise<CoachRuleEventRow[]> {
  const { data, error } = await supabase
    .from("coach_rule_events")
    .select("*")
    .eq("rule_id", ruleId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

// ------------------------------------------------------------------
// RPCs (writes)
// ------------------------------------------------------------------
export interface CreateDraftInput {
  category: CoachRuleCategory;
  ruleType: CoachRuleType;
  title: string;
  content: string;
  priority?: number;
  scopeKind?: CoachRuleScopeKind;
  scopeRef?: CoachRuleScopeRef;
  validFrom?: string | null;
  validUntil?: string | null;
}

export async function createCoachRuleDraft(
  input: CreateDraftInput,
): Promise<{ rule_id: string; version_id: string }> {
  const { data, error } = await supabase.rpc("create_coach_rule_draft", {
    _category: input.category,
    _rule_type: input.ruleType,
    _title: input.title,
    _content: input.content,
    _priority: input.priority ?? 50,
    _scope_kind: input.scopeKind ?? "company",
    _scope_ref: (input.scopeRef ?? {}) as never,
    _valid_from: input.validFrom ?? null,
    _valid_until: input.validUntil ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("RPC não retornou linha.");
  return row as { rule_id: string; version_id: string };
}

export interface CreateVersionInput {
  ruleId: string;
  ruleType: CoachRuleType;
  title: string;
  content: string;
  priority?: number;
  scopeKind?: CoachRuleScopeKind;
  scopeRef?: CoachRuleScopeRef;
  baseVersionId?: string | null;
}

export async function createCoachRuleVersion(input: CreateVersionInput): Promise<string> {
  const { data, error } = await supabase.rpc("create_coach_rule_version", {
    _rule_id: input.ruleId,
    _rule_type: input.ruleType,
    _title: input.title,
    _content: input.content,
    _priority: input.priority ?? 50,
    _scope_kind: input.scopeKind ?? null,
    _scope_ref: (input.scopeRef ?? null) as never,
    _base_version_id: input.baseVersionId ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function submitCoachRuleVersion(versionId: string): Promise<void> {
  const { error } = await supabase.rpc("submit_coach_rule_version", { _version_id: versionId });
  if (error) throw error;
}

export async function approveCoachRuleVersion(
  versionId: string,
  criticalConfirmed = false,
): Promise<void> {
  const { error } = await supabase.rpc("approve_coach_rule_version", {
    _version_id: versionId,
    _critical_confirmed: criticalConfirmed,
  });
  if (error) throw error;
}

export async function rejectCoachRuleVersion(versionId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("reject_coach_rule_version", {
    _version_id: versionId,
    _reason: reason,
  });
  if (error) throw error;
}

export async function activateCoachRuleVersion(versionId: string): Promise<void> {
  const { error } = await supabase.rpc("activate_coach_rule_version", { _version_id: versionId });
  if (error) throw error;
}

export async function pauseOrResumeCoachRule(ruleId: string): Promise<void> {
  const { error } = await supabase.rpc("pause_coach_rule", { _rule_id: ruleId });
  if (error) throw error;
}

export async function archiveCoachRule(ruleId: string): Promise<void> {
  const { error } = await supabase.rpc("archive_coach_rule", { _rule_id: ruleId });
  if (error) throw error;
}

export async function replaceCoachRule(oldRuleId: string, newRuleId: string): Promise<void> {
  const { error } = await supabase.rpc("replace_coach_rule", {
    _old_rule_id: oldRuleId,
    _new_rule_id: newRuleId,
  });
  if (error) throw error;
}
