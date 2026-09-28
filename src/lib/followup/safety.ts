// ============================================================================
// followup/safety.ts
// Responsabilidade: detecção da janela de 24h do WhatsApp Cloud API.
//
// As demais proteções mudaram de lugar no Follow-up V2: limite de tentativas
// e intervalo são do ciclo (`cycles.ts`/`next-contact.ts`) e o que invalida
// um envio é revalidado no último instante pelo `dispatch.ts`.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Fora da janela de 24h da Meta = nenhuma mensagem do cliente nas últimas
 * 23h (buffer contra borda de fuso/atraso). Fora dela só template aprovado.
 */
export async function isOutsideWhatsappWindow(conversationId: string): Promise<boolean> {
  const cutoff24 = new Date(Date.now() - 23 * 3600 * 1000).toISOString();
  const { data: clientMsg } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("role", "lead")
    .gte("at", cutoff24)
    .limit(1);
  return !clientMsg || clientMsg.length === 0;
}
