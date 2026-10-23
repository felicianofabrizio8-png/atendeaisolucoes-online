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

/**
 * Política única de resposta automática. Precedência:
 * 1. chave-mestra da empresa (`sales_agent_master_enabled === false`) bloqueia tudo;
 * 2. takeover humano bloqueia;
 * 3. empresa: com a Vendedora V2, o modo decide (silent nunca, automatic sempre,
 *    assisted só com opt-in da conversa); sem V2, o escopo (desligado nunca, geral
 *    sempre, teste só com opt-in da conversa);
 * 4. conversa: opt-in único `conversations.sales_agent_auto_reply`.
 */
export function isAutomaticReplyAllowed(input: {
  scope?: unknown;
  mode?: unknown;
  legacyEnabled?: boolean;
  masterEnabled?: boolean | null;
  /** Opt-in da conversa (`sales_agent_auto_reply`). */
  salesAgentAutoReply?: boolean | null;
  /** @deprecated alias de `salesAgentAutoReply`, mantido para chamadores antigos. */
  conversationEnabled?: boolean | null;
  aiStatus?: string | null;
  humanTakeoverAt?: string | null;
}):
  | { ok: true }
  | { ok: false; reason: "master_disabled" | "disabled" | "conversation_not_authorized" | "human_active" } {
  if (input.masterEnabled === false) return { ok: false, reason: "master_disabled" };
  if (isHumanTakeoverActive(input)) return { ok: false, reason: "human_active" };
  const conversationOptIn = input.salesAgentAutoReply === true || input.conversationEnabled === true;
  const mode = normalizeAiReplyMode(input.mode);

  if (mode === "silent") return { ok: false, reason: "disabled" };
  if (mode === "automatic") return { ok: true };
  if (mode === "assisted") {
    return conversationOptIn ? { ok: true } : { ok: false, reason: "conversation_not_authorized" };
  }

  const scope = normalizeAiReplyScope(input.scope, input.legacyEnabled ?? false);
  if (scope === "desligado") return { ok: false, reason: "disabled" };
  if (scope === "teste" && !conversationOptIn) {
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
