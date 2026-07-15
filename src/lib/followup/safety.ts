// ============================================================================
// followup/safety.ts
// Responsabilidade: decidir se um candidato pode receber follow-up agora,
// aplicando bloqueios de handoff humano, spam recente, limite por lead,
// intervalo mínimo entre envios e detecção da janela de 24h do WhatsApp.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Candidate, FollowupSettings, SafetyCheck } from "./types";

export async function canSend(
  companyId: string,
  c: Candidate,
  s: FollowupSettings,
): Promise<SafetyCheck> {
  // Conversa precisa estar elegível agora
  const { data: conv } = await supabaseAdmin
    .from("conversations")
    .select("ai_status, ai_handling, human_takeover_at, last_message_at")
    .eq("id", c.conversationId)
    .maybeSingle();
  if (!conv) return { ok: false, reason: "conversa não encontrada" };
  if (conv.ai_status === "assumido_humano" || conv.human_takeover_at)
    return { ok: false, reason: "humano assumiu" };
  if (conv.ai_status === "desinteresse")
    return { ok: false, reason: "cliente sem interesse" };
  if (conv.ai_handling) return { ok: false, reason: "IA em processamento" };

  // Última mensagem do agente recente? evita spam (janela 30 min)
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: recentAgent } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("conversation_id", c.conversationId)
    .eq("role", "agent")
    .gte("at", cutoff)
    .limit(1);
  if (recentAgent && recentAgent.length > 0)
    return { ok: false, reason: "mensagem recente do agente" };

  // Quantidade máxima por lead
  const { data: existing } = await supabaseAdmin
    .from("follow_ups")
    .select("id, sent_at")
    .eq("company_id", companyId)
    .eq("lead_id", c.leadId)
    .order("sent_at", { ascending: false });
  const attempts = existing?.length ?? 0;
  if (attempts >= s.maxPerLead)
    return { ok: false, reason: "máximo de follow-ups atingido" };
  const lastFup = existing?.[0]?.sent_at ?? null;
  if (lastFup) {
    const diffHrs = (Date.now() - new Date(lastFup).getTime()) / 3600_000;
    if (diffHrs < s.minHoursBetween)
      return { ok: false, reason: `aguardando intervalo mínimo (${s.minHoursBetween}h)` };
  }

  // Verifica janela 24h do WhatsApp Cloud API. Fora dela ainda permitimos
  // o envio, mas via template Utility aprovado (decisão no loop principal).
  const cutoff24 = new Date(Date.now() - 23 * 3600 * 1000).toISOString();
  const { data: clientMsg } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("conversation_id", c.conversationId)
    .eq("role", "lead")
    .gte("at", cutoff24)
    .limit(1);
  const outsideWindow = !clientMsg || clientMsg.length === 0;

  return { ok: true, attempt: attempts + 1, outsideWindow };
}
