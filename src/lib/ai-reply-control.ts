export const AI_REPLY_SCOPES = ["desligado", "teste", "geral"] as const;
export type AiReplyScope = (typeof AI_REPLY_SCOPES)[number];

export const AI_REPLY_MODES = ["silent", "assisted", "automatic"] as const;
export type AiReplyMode = (typeof AI_REPLY_MODES)[number];

export const AI_CONVERSATION_ACTIONS = ["takeover", "resume", "disable"] as const;
export type AiConversationAction = (typeof AI_CONVERSATION_ACTIONS)[number];

export function parseAiConversationAction(value: unknown): AiConversationAction | null {
  return value === "takeover" || value === "resume" || value === "disable" ? value : null;
}

export function normalizeAiReplyScope(value: unknown, legacyEnabled = false): AiReplyScope {
  if (value === "teste" || value === "geral" || value === "desligado") return value;
  return legacyEnabled ? "geral" : "desligado";
}

export function normalizeAiReplyMode(value: unknown): AiReplyMode | null {
  return AI_REPLY_MODES.includes(value as AiReplyMode) ? (value as AiReplyMode) : null;
}

export function isAutomaticReplyAllowed(input: {
  scope?: unknown;
  mode?: unknown;
  legacyEnabled?: boolean;
  conversationEnabled?: boolean | null;
  salesAgentAutoReply?: boolean | null;
  aiStatus?: string | null;
  humanTakeoverAt?: string | null;
}):
  | { ok: true }
  | { ok: false; reason: "disabled" | "conversation_not_authorized" | "human_active" } {
  const mode = normalizeAiReplyMode(input.mode);
  const conversationAutoReply = input.salesAgentAutoReply ?? input.conversationEnabled ?? false;

  // V2 modes are authoritative when present. Automatic is an explicit company-level
  // policy; assisted only becomes executable for the conversation opt-in; silent
  // never produces an automatic reply.
  if (mode === "silent") return { ok: false, reason: "disabled" };
  if (mode === "assisted" && conversationAutoReply !== true) {
    return { ok: false, reason: "conversation_not_authorized" };
  }
  if (mode === "automatic" || mode === "assisted") {
    if (isHumanTakeoverActive(input)) return { ok: false, reason: "human_active" };
    return { ok: true };
  }

  const scope = normalizeAiReplyScope(input.scope, input.legacyEnabled ?? false);
  if (scope === "desligado") return { ok: false, reason: "disabled" };
  if (isHumanTakeoverActive(input)) return { ok: false, reason: "human_active" };
  if (scope === "teste" && input.conversationEnabled !== true) {
    return { ok: false, reason: "conversation_not_authorized" };
  }
  return { ok: true };
}

/** Shared pure definition used by every automatic-effect gate. */
export function isHumanTakeoverActive(input: {
  aiStatus?: string | null;
  humanTakeoverAt?: string | null;
}): boolean {
  return (
    input.aiStatus === "aguardando_humano" ||
    input.aiStatus === "assumido_humano" ||
    Boolean(input.humanTakeoverAt)
  );
}
