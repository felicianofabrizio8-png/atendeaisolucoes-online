import { supabase } from "@/integrations/supabase/client";

export type ConversationControlAction = "takeover" | "resume";
export type ConversationControlState = {
  ai_status: string | null;
  ai_handling: boolean;
  ai_reply_enabled: boolean;
  human_takeover_at: string | null;
};

export async function changeConversationControl(
  conversationId: string,
  action: ConversationControlAction,
): Promise<{ ok: true; state: ConversationControlState } | { ok: false; error: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "Sessão expirada. Entre novamente para controlar o atendimento." };

  const response = await fetch("/api/ai/agent-takeover", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ conversation_id: conversationId, action }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.ok || !body.conversation) {
    return { ok: false, error: body?.error ?? "Não foi possível atualizar o controle do atendimento." };
  }
  return { ok: true, state: body.conversation as ConversationControlState };
}
