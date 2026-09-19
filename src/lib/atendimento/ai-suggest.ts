import { supabase } from "@/integrations/supabase/client";

export type AiReplySuggestion =
  | { ok: true; kind: "reply"; message: string }
  | { ok: true; kind: "handoff"; reason: string }
  | { ok: true; kind: "skip"; reason: string }
  | { ok: false; error: string };

export async function suggestAiReply(
  conversationId: string,
  signal?: AbortSignal,
): Promise<AiReplySuggestion> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    return { ok: false, error: "Sessão expirada" };
  }

  try {
    const response = await fetch("/api/ai/suggest-reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ conversation_id: conversationId }),
      signal,
    });

    const payload = (await response.json()) as {
      ok?: boolean;
      kind?: "reply" | "handoff" | "skip";
      message?: string;
      reason?: string;
      error?: string;
    };

    if (!response.ok || payload.ok !== true) {
      return {
        ok: false,
        error: payload.error ?? "Falha ao gerar sugestão",
      };
    }

    if (payload.kind === "reply" && typeof payload.message === "string" && payload.message.trim()) {
      return { ok: true, kind: "reply", message: payload.message.trim() };
    }

    if (payload.kind === "handoff") {
      return { ok: true, kind: "handoff", reason: payload.reason ?? "Atendimento humano necessário" };
    }

    return { ok: true, kind: "skip", reason: payload.reason ?? "Sem sugestão disponível" };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : "Falha ao gerar sugestão",
    };
  }
}
