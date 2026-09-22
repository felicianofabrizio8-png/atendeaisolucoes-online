import {
  buildPendingAssistedSuggestion,
  type AssistedSuggestionInsert,
} from "./sales-agent-assisted";
import type { SalesAgentAuditDecision } from "./sales-agent-audit";
import type { SalesAgentMode } from "./sales-agent-mode";
import { prepareSalesAgentAction } from "./sales-agent-v2-tools";

export type SalesAgentReplyAuthorization =
  | { kind: "legacy" }
  | { kind: "authorized" }
  | { kind: "blocked"; reason: "v2_silent" | "v2_assisted_approval_required" }
  | { kind: "error"; reason: "suggestion_persist_error" | "action_not_allowed" | "invalid_input" };

type AuditDetails = {
  decision: SalesAgentAuditDecision;
  result: string;
  productIds: readonly string[];
  tools: readonly string[];
  blocked: string | null;
};

export type SalesAgentReplyAuthorizationInput = {
  mode: SalesAgentMode | null;
  companyId: string;
  conversationId: string;
  leadId: string;
  text: string;
  productIds?: readonly string[];
  persistSuggestion: (input: AssistedSuggestionInsert) => Promise<{ ok: true } | { ok: false }>;
  audit: (details: AuditDetails) => Promise<void>;
};

export async function authorizeSalesAgentReply(
  input: SalesAgentReplyAuthorizationInput,
): Promise<SalesAgentReplyAuthorization> {
  if (input.mode === null) return { kind: "legacy" };
  const productIds = input.productIds ?? [];
  if (input.mode === "silent") {
    await input.audit({
      decision: "skipped",
      result: "mode_gate",
      productIds,
      tools: ["mode_guard"],
      blocked: "v2_silent",
    });
    return { kind: "blocked", reason: "v2_silent" };
  }
  if (input.mode === "assisted") {
    const pending = buildPendingAssistedSuggestion({
      companyId: input.companyId,
      conversationId: input.conversationId,
      leadId: input.leadId,
      text: input.text,
      productIds,
    });
    const persisted = await input.persistSuggestion(pending);
    if (!persisted.ok) {
      await input.audit({
        decision: "error",
        result: "suggestion_persist_error",
        productIds,
        tools: ["assisted_suggestion"],
        blocked: "suggestion_persist_error",
      });
      return { kind: "error", reason: "suggestion_persist_error" };
    }
    await input.audit({
      decision: "skipped",
      result: "suggestion_pending",
      productIds,
      tools: ["mode_guard", "assisted_suggestion"],
      blocked: "approval_required",
    });
    return { kind: "blocked", reason: "v2_assisted_approval_required" };
  }
  const contract = prepareSalesAgentAction({
    v2Enabled: true,
    mode: input.mode,
    companyId: input.companyId,
    kind: "send_text",
    conversationId: input.conversationId,
    leadId: input.leadId,
    text: input.text,
    productIds,
  });
  if (!contract.ok) {
    await input.audit({
      decision: "error",
      result: "tool_error",
      productIds,
      tools: ["action_contract"],
      blocked: contract.code,
    });
    return {
      kind: "error",
      reason: contract.code === "invalid_input" ? "invalid_input" : "action_not_allowed",
    };
  }
  await input.audit({
    decision: "reply",
    result: "validated",
    productIds,
    tools: ["action_contract"],
    blocked: null,
  });
  return { kind: "authorized" };
}
