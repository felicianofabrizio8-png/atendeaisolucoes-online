import { normalizeAiReplyScope, type AiReplyScope } from "@/lib/ai-reply-control";

export type ConversationControlPresentation =
  | "bruna_ativa"
  | "ia_desativada"
  | "aguardando_humano"
  | "atendimento_assumido";

export type ControlPresentationInput = {
  ai_status?: string | null;
  ai_reply_enabled?: boolean;
  human_takeover_at?: string | null;
  global_scope?: AiReplyScope | null;
  global_enabled?: boolean;
};

export function resolveConversationControl(input: ControlPresentationInput): ConversationControlPresentation {
  if (input.ai_status === "assumido_humano" || input.human_takeover_at) return "atendimento_assumido";
  if (input.ai_status === "aguardando_humano") return "aguardando_humano";
  const globalDisabled = input.global_scope != null
    ? normalizeAiReplyScope(input.global_scope, input.global_enabled ?? false) === "desligado"
    : input.global_enabled === false;
  if (globalDisabled || input.ai_reply_enabled === false) return "ia_desativada";
  return "bruna_ativa";
}
