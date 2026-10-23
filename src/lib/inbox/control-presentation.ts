import {
  isAutomaticReplyAllowed,
  type AiReplyMode,
  type AiReplyScope,
} from "@/lib/ai-reply-control";

export type ConversationControlPresentation =
  | "bruna_ativa"
  | "ia_desativada"
  | "aguardando_humano"
  | "atendimento_assumido";

export type ControlPresentationInput = {
  ai_status?: string | null;
  human_takeover_at?: string | null;
  /** Opt-in da conversa (`conversations.sales_agent_auto_reply`). */
  sales_agent_auto_reply?: boolean | null;
  /** Chave-mestra da empresa (`company_settings.sales_agent_master_enabled`). */
  master_enabled?: boolean | null;
  /** Modo efetivo da Vendedora V2; ausente quando a V2 está desligada. */
  mode?: AiReplyMode | null;
  global_scope?: AiReplyScope | null;
  global_enabled?: boolean;
};

/** Mostra exatamente o que a política de resposta automática decide. */
export function resolveConversationControl(input: ControlPresentationInput): ConversationControlPresentation {
  if (input.ai_status === "assumido_humano" || input.human_takeover_at) return "atendimento_assumido";
  if (input.ai_status === "aguardando_humano") return "aguardando_humano";
  const decision = isAutomaticReplyAllowed({
    masterEnabled: input.master_enabled,
    mode: input.mode,
    scope: input.global_scope,
    legacyEnabled: input.global_enabled ?? false,
    salesAgentAutoReply: input.sales_agent_auto_reply,
    aiStatus: input.ai_status,
    humanTakeoverAt: input.human_takeover_at,
  });
  return decision.ok ? "bruna_ativa" : "ia_desativada";
}
