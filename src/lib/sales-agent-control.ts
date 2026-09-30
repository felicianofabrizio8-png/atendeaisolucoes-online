// ============================================================================
// Devolver a conversa para a Vendedora IA.
//
// Depois de `aguardando_humano` / `assumido_humano` a IA fica bloqueada. Um
// atendente da MESMA empresa pode devolver a conversa: limpa o status humano
// e registra quem devolveu. A IA volta a atuar na próxima mensagem do
// cliente (não responde retroativamente). company_id sempre vem do perfil
// autenticado, nunca do payload.
// ============================================================================

type Result<T> = PromiseLike<{ data: T | null; error: unknown }>;

// Subconjunto do supabase-js usado aqui (injetável em testes).
export interface ConversationControlClient {
  from(table: "conversations"): {
    update(values: Record<string, unknown>): {
      eq(
        column: string,
        value: string,
      ): {
        eq(
          column: string,
          value: string,
        ): {
          select(columns: string): { maybeSingle(): Result<{ id: string }> };
        };
      };
    };
  };
  from(table: "ai_flow_events"): {
    insert(values: Record<string, unknown>): PromiseLike<{ error: unknown }>;
  };
}

export type ReleaseToAiResult =
  | { ok: true }
  | { ok: false; code: "invalid_input" | "not_found" | "update_failed" };

export async function releaseConversationToAi(
  client: ConversationControlClient,
  input: { companyId: string; conversationId: string; userId: string },
): Promise<ReleaseToAiResult> {
  if (!input.companyId.trim() || !input.conversationId.trim() || !input.userId.trim()) {
    return { ok: false, code: "invalid_input" };
  }
  const { data, error } = await client
    .from("conversations")
    .update({ ai_status: null, human_takeover_at: null, ai_handling: false })
    .eq("id", input.conversationId)
    .eq("company_id", input.companyId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, code: "update_failed" };
  if (!data) return { ok: false, code: "not_found" };
  try {
    await client.from("ai_flow_events").insert({
      company_id: input.companyId,
      conversation_id: input.conversationId,
      lead_id: null,
      event_type: "returned_to_ai",
      payload: { released_by: input.userId },
    });
  } catch {
    // Auditoria best-effort: não desfaz a devolução.
  }
  return { ok: true };
}
