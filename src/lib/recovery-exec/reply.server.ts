// ============================================================================
// Detecção de resposta a uma tentativa de recuperação (Fase 6.3) — SERVER.
//
// Chamado pelo webhook quando chega mensagem do LEAD. Se existe uma tentativa
// enviada e ainda sem resposta nesta conversa, marcamos `replied`. Nunca
// dispara nada — apenas fecha o ciclo de aprendizado da recuperação.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sanitizeForLog } from "@/lib/recovery-ai/redact";
import { mapAttempt, logAttemptEvent } from "./attempts.server";
import { canTransition } from "./states";

const RESPONDABLE = ["sent", "delivered", "read"] as const;

/**
 * Marca como respondida a tentativa mais recente da conversa, se houver.
 * Idempotente: uma tentativa já `replied` não é tocada de novo.
 */
export async function markRecoveryReplied(args: {
  companyId: string;
  conversationId: string;
  repliedAt: string;
}): Promise<{ marked: boolean }> {
  try {
    const { data } = await supabaseAdmin
      .from("recovery_attempts")
      .select("*")
      .eq("company_id", args.companyId)
      .eq("conversation_id", args.conversationId)
      .in("status", [...RESPONDABLE])
      .order("created_at", { ascending: false })
      .limit(1);

    const row = ((data ?? []) as Array<Record<string, unknown>>)[0];
    if (!row) return { marked: false };

    const attempt = mapAttempt(row);
    if (!canTransition(attempt.status, "replied")) return { marked: false };

    const { data: updated } = await supabaseAdmin
      .from("recovery_attempts")
      .update({
        status: "replied",
        response_status: "replied",
        replied_at: args.repliedAt,
      })
      .eq("company_id", args.companyId)
      .eq("id", attempt.id)
      .eq("status", attempt.status)
      .select("id")
      .maybeSingle();

    if (!updated) return { marked: false };

    await logAttemptEvent({
      companyId: args.companyId,
      attemptId: attempt.id,
      conversationId: args.conversationId,
      leadId: attempt.leadId,
      userId: null,
      eventType: "recovery_reply_detected",
      metadata: { previous_status: attempt.status },
    });
    return { marked: true };
  } catch (e) {
    // Detecção de resposta nunca pode derrubar o webhook.
    console.error("[recovery/reply] failed", sanitizeForLog(String(e)));
    return { marked: false };
  }
}
