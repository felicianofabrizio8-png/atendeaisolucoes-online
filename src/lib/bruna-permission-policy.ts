import { isAutomaticReplyAllowed, isHumanTakeoverActive } from "./ai-reply-control";
import {
  resolveSalesAgentMode,
  type SalesAgentMode,
  type SalesAgentModeSettings,
} from "./sales-agent-mode";

/**
 * Read-only input for the Bruna permission policy.
 *
 * This module deliberately has no database, network, or sender dependency. It
 * is a compatibility seam for future integrations; existing callers are not
 * changed by this policy.
 */
export interface BrunaPermissionInput extends SalesAgentModeSettings {
  /** Legacy company switch used by the pre-V2 agent. */
  ai_auto_reply_enabled?: boolean | null;
  /** Company-level master switch for the Bruna/Sales Agent integration. */
  sales_agent_master_enabled?: boolean | null;
  /** Conversation-level V2 opt-in (sales_agent_auto_reply). */
  sales_agent_auto_reply?: boolean | null;
  ai_status?: string | null;
  human_takeover_at?: string | null;
  /** A decision already produced by the agent, not a request to produce one. */
  handoff_requested?: boolean;
}

export type BrunaPermissionReason =
  | "automatic_mode"
  | "assisted_conversation_enabled"
  | "assisted_approval_required"
  | "silent_mode"
  | "legacy_enabled"
  | "legacy_disabled"
  | "master_disabled"
  | "human_takeover"
  | "handoff_requested"
  | "handoff_not_requested"
  | "handoff_already_owned"
  | "followup_legacy_gate"
  | "followup_human_takeover";

export interface BrunaPermissionDecision {
  readonly allowed: boolean;
  readonly reason: BrunaPermissionReason;
  readonly mode: SalesAgentMode | null;
}

export interface BrunaPermissionPolicy {
  readonly mode: SalesAgentMode | null;
  readonly reply: BrunaPermissionDecision;
  /** Follow-up remains on its existing gate until it is explicitly integrated. */
  readonly followup: BrunaPermissionDecision;
  readonly handoff: BrunaPermissionDecision;
  /** Known precedence differences are reported, never silently reconciled. */
  readonly divergences: readonly BrunaPermissionDivergence[];
}

export type BrunaPermissionDivergence =
  | "master_disabled_but_legacy_enabled"
  | "silent_but_conversation_auto_reply_enabled"
  | "v2_mode_ignores_legacy_flag";

function decision(
  allowed: boolean,
  reason: BrunaPermissionReason,
  mode: SalesAgentMode | null,
): BrunaPermissionDecision {
  return { allowed, reason, mode };
}

/**
 * Central pure resolution for Bruna's current permission contract.
 *
 * Precedence is intentionally inherited from the two existing pure modules:
 * the master switch disables V2, V2 mode is authoritative when active, and
 * legacy `ai_auto_reply_enabled` is consulted only outside V2. Takeover blocks
 * automatic effects. Follow-up is reported as legacy-gated because its current
 * gate has not been integrated with V2 settings; this avoids changing behavior
 * merely by introducing this policy.
 */
export function resolveBrunaPermissionPolicy(input: BrunaPermissionInput): BrunaPermissionPolicy {
  const mode = resolveSalesAgentMode(input);
  const takeover = isHumanTakeoverActive({
    aiStatus: input.ai_status,
    humanTakeoverAt: input.human_takeover_at,
  });
  const conversationAutoReply = input.sales_agent_auto_reply === true;
  const divergences: BrunaPermissionDivergence[] = [];

  if (input.sales_agent_master_enabled === false && input.ai_auto_reply_enabled === true) {
    divergences.push("master_disabled_but_legacy_enabled");
  }
  if (mode === "silent" && conversationAutoReply) {
    divergences.push("silent_but_conversation_auto_reply_enabled");
  }
  if (mode !== null && input.ai_auto_reply_enabled != null) {
    divergences.push("v2_mode_ignores_legacy_flag");
  }

  let reply: BrunaPermissionDecision;
  if (input.sales_agent_master_enabled === false) {
    reply = decision(false, "master_disabled", null);
  } else if (takeover) {
    reply = decision(false, "human_takeover", mode);
  } else if (mode === "automatic") {
    reply = decision(true, "automatic_mode", mode);
  } else if (mode === "assisted") {
    reply = decision(
      conversationAutoReply,
      conversationAutoReply ? "assisted_conversation_enabled" : "assisted_approval_required",
      mode,
    );
  } else if (mode === "silent") {
    reply = decision(false, "silent_mode", mode);
  } else {
    const legacy = isAutomaticReplyAllowed({
      legacyEnabled: input.ai_auto_reply_enabled === true,
      aiStatus: input.ai_status,
      humanTakeoverAt: input.human_takeover_at,
    });
    reply = decision(
      legacy.ok,
      legacy.ok
        ? "legacy_enabled"
        : legacy.reason === "disabled"
          ? "legacy_disabled"
          : "human_takeover",
      null,
    );
  }

  // Existing follow-up dispatch has its own settings, quota, and revalidation
  // gate. Only its already-established human takeover guard is represented here.
  const followup = decision(
    !takeover,
    takeover ? "followup_human_takeover" : "followup_legacy_gate",
    mode,
  );

  const handoff = input.handoff_requested
    ? decision(!takeover, takeover ? "handoff_already_owned" : "handoff_requested", mode)
    : decision(false, "handoff_not_requested", mode);

  return { mode, reply, followup, handoff, divergences };
}
