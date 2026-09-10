import type { AgentContext, SalesAgentSessionCorrection } from "./sales-agent-core";
import type { ActiveCoachRuleGrounding } from "./coach-rules/coach-rules.repository";
import type { QuickReplyGrounding } from "./quick-replies/quick-replies.repository";

type ClassifiedItem = {
  companyId?: string | null;
  domain?: string | null;
  intent?: string | null;
  conflictKey?: string | null;
};

export type NormativeCorrection = SalesAgentSessionCorrection;
type Learning = AgentContext["grounding"]["approvedCoachLearnings"][number];
type Rule = ActiveCoachRuleGrounding;

function requireCompanyId(companyId: string): string {
  const value = companyId.trim();
  if (!value) throw new Error("sales_agent_company_id_required");
  return value;
}

function explicitKey(item: ClassifiedItem): string | null {
  const direct = item.conflictKey?.trim();
  if (direct) return direct;
  const domain = item.domain?.trim();
  const intent = item.intent?.trim();
  return domain && intent ? `${domain}:${intent}` : null;
}

function assertCompanyScope(companyId: string, items: ClassifiedItem[]): void {
  if (items.some((item) => item.companyId != null && item.companyId !== companyId)) {
    throw new Error("sales_agent_normative_company_scope_mismatch");
  }
}

export function resolvePersistedSalesAgentLearnings(
  companyId: string,
  learnings: Learning[],
): Learning[] {
  const normalizedCompanyId = requireCompanyId(companyId);
  assertCompanyScope(normalizedCompanyId, learnings);
  const correctionKeys = new Set(
    learnings
      .filter((item) => item.sourceTrainingMessageId != null)
      .map(explicitKey)
      .filter((key): key is string => key != null),
  );
  return learnings.filter((item) => {
    const key = explicitKey(item);
    return !(key != null && correctionKeys.has(key) && item.sourceTrainingMessageId == null);
  });
}

/** Único filtro normativo compartilhado por treino e produção. */
export function resolveSalesAgentNormativeContext(input: {
  companyId: string;
  context: AgentContext;
  sessionCorrections?: NormativeCorrection[];
}): AgentContext & { sessionCorrections: NormativeCorrection[] } {
  const companyId = requireCompanyId(input.companyId);
  if (input.context.settings.company_id !== companyId) {
    throw new Error("sales_agent_normative_company_scope_mismatch");
  }
  const corrections = (input.sessionCorrections ?? []).filter(
    (item) => item.correction.trim().length > 0,
  );
  const learnings = input.context.grounding.approvedCoachLearnings;
  const rules = input.context.grounding.activeCoachRules ?? [];
  const quickReplies = input.context.grounding.quickReplies ?? [];
  assertCompanyScope(companyId, [...corrections, ...learnings, ...rules, ...quickReplies]);
  const sessionConflictKeys = new Set(
    corrections.map(explicitKey).filter((key): key is string => key != null),
  );
  const persistedCorrectionKeys = new Set(
    learnings
      .filter((item) => item.sourceTrainingMessageId != null)
      .map(explicitKey)
      .filter((key): key is string => key != null),
  );
  const defeatedKeys = new Set([...sessionConflictKeys, ...persistedCorrectionKeys]);
  const isDefeated = (item: ClassifiedItem & { sourceTrainingMessageId?: string | null }) => {
    const key = explicitKey(item);
    return key != null && defeatedKeys.has(key) && item.sourceTrainingMessageId == null;
  };
  return {
    ...input.context,
    grounding: {
      ...input.context.grounding,
      catalog: input.context.grounding.catalog,
      commercialRules: input.context.grounding.commercialRules,
      approvedCoachLearnings: resolvePersistedSalesAgentLearnings(
        companyId,
        learnings.filter((item) => !isDefeated(item)),
      ),
      activeCoachRules: rules.filter((item) => !isDefeated(item)),
      quickReplies: quickReplies.filter((item) => !isDefeated(item)),
    },
    sessionCorrections: corrections,
  };
}
