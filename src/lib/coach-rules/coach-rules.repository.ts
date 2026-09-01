// Repository do Coach V2 — Fase 1.
// Todas as leituras usam o client autenticado (RLS aplica).
// Todas as escritas são feitas via RPC (SECURITY DEFINER) que valida admin.
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
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
  "identity",
  "tone",
  "qualification",
  "sales",
  "pricing",
  "negotiation",
  "discounts",
  "payments",
  "followup",
  "human_handoff",
  "prohibitions",
  "safety",
  "after_sales",
  "other",
] as const;

export const COACH_RULE_TYPES: readonly CoachRuleType[] = [
  "instruction",
  "prohibition",
  "mandatory_action",
  "mandatory_question",
  "handoff",
  "standard_reply",
  "preference",
] as const;

export const COACH_RULE_SCOPES: readonly CoachRuleScopeKind[] = [
  "company",
  "agent",
  "channel",
] as const;

export const COACH_CHANNELS = ["whatsapp", "instagram", "facebook", "web", "other"] as const;

export const COACH_CRITICAL_CATEGORIES = new Set<CoachRuleCategory>([
  "safety",
  "pricing",
  "discounts",
  "payments",
  "prohibitions",
  "human_handoff",
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

export type CoachRuleScopeRef = {
  agent_id?: string;
  channel?: (typeof COACH_CHANNELS)[number];
};

export interface ActiveCoachRuleGrounding {
  ruleId: string;
  versionId: string;
  versionNumber: number;
  category: CoachRuleCategory;
  ruleType: CoachRuleType;
  title: string;
  content: string;
  priority: number;
  scopeKind: CoachRuleScopeKind;
  scopeRef: Database["public"]["Tables"]["coach_rules"]["Row"]["scope_ref"];
}

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

export async function listActiveCoachRulesForGrounding(
  companyId: string,
  limit = 20,
  client: SupabaseClient<Database> = supabase,
): Promise<ActiveCoachRuleGrounding[]> {
  const safeLimit = Math.min(50, Math.max(1, limit));
  const { data: rules, error: rulesError } = await client
    .from("coach_rules")
    .select("id, active_version_id, category, priority")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("priority", { ascending: false })
    .limit(safeLimit);
  if (rulesError) throw rulesError;

  const activeRules = (rules ?? []).filter(
    (
      rule,
    ): rule is Pick<CoachRuleRow, "id" | "active_version_id" | "category" | "priority"> & {
      active_version_id: string;
    } =>
      typeof rule.active_version_id === "string",
  );
  if (activeRules.length === 0) return [];

  const activeVersionIds = activeRules.map((rule) => rule.active_version_id);
  const { data: versions, error: versionsError } = await client
    .from("coach_rule_versions")
    .select(
      "id, rule_id, company_id, version_number, rule_type, category, title, content, priority, scope_kind, scope_ref, status",
    )
    .eq("company_id", companyId)
    .eq("status", "approved")
    .in("id", activeVersionIds);
  if (versionsError) throw versionsError;

  const versionsById = new Map((versions ?? []).map((version) => [version.id, version]));
  return activeRules.flatMap((rule) => {
    const version = versionsById.get(rule.active_version_id);
    if (
      !version ||
      version.rule_id !== rule.id ||
      version.company_id !== companyId ||
      version.status !== "approved"
    ) {
      return [];
    }
    return [{
      ruleId: rule.id,
      versionId: version.id,
      versionNumber: version.version_number,
      category: version.category,
      ruleType: version.rule_type,
      title: version.title,
      content: version.content,
      priority: version.priority ?? rule.priority,
      scopeKind: version.scope_kind,
      scopeRef: version.scope_ref,
    }];
  });
}

export async function getCoachRule(ruleId: string): Promise<CoachRuleRow | null> {
  const { data, error } = await supabase
    .from("coach_rules")
    .select("*")
    .eq("id", ruleId)
    .maybeSingle();
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
    _valid_from: input.validFrom ?? undefined,
    _valid_until: input.validUntil ?? undefined,
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
    _scope_kind: input.scopeKind ?? undefined,
    _scope_ref: (input.scopeRef ?? undefined) as never,
    _base_version_id: input.baseVersionId ?? undefined,
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
