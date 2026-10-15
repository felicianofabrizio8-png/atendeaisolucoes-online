import { supabase } from "@/integrations/supabase/client";
import type { CopilotTurn } from "./copilot-chat";
export async function askConversationCopilot(params: {
  conversationId: string;
  question: string;
  history: CopilotTurn[];
  files: File[];
  signal: AbortSignal;
}): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sua sessão expirou. Entre novamente.");
  const body = new FormData();
  body.set("conversation_id", params.conversationId);
  body.set("question", params.question);
  body.set("history", JSON.stringify(params.history));
  for (const file of params.files) body.append("files", file);
  const response = await fetch("/api/atendimento/copilot", {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session.access_token}` },
    body,
    signal: params.signal,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || typeof result?.answer !== "string") {
    throw new Error(result?.error || "Não foi possível consultar a IA. Tente novamente.");
  }
  return result.answer;
}
