// ============================================================================
// followup/manual.ts
// Responsabilidade: núcleo do disparo manual de follow-up executado por um
// administrador via inbox. É chamado pela server function
// `runFollowupNowForConversation` (mantida por compatibilidade em
// src/lib/manual-followup.functions.ts). Ignora janelas de tempo, mas
// mantém proteções essenciais (handoff humano, desinteresse, spam 30s).
//
// Mensagem, janela 24h, revalidação, envio e persistência são o mesmo motor
// do tick (`message.ts` + `dispatch.ts`) — fora da janela sai o
// `chamar_novamente` com a retomada contextual.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";

import { dispatchFollowup } from "./dispatch";
import { buildMessage } from "./message";
import { isOutsideWhatsappWindow } from "./safety";
import { getFollowupSettings, getFollowupV2Settings } from "./settings";
import type { Candidate, ManualFollowupResult } from "./types";

export interface ManualFollowupInput {
  companyId: string;
  userId: string;
  conversationId: string;
}

export async function runManualFollowup(input: ManualFollowupInput): Promise<ManualFollowupResult> {
  const { companyId, userId, conversationId } = input;

  const settings = await getFollowupSettings(companyId);
  if (!settings) {
    return { eligible: false, blockedReason: "configuração de follow-up não encontrada" };
  }

  const { data: conv } = await supabaseAdmin
    .from("conversations")
    .select(
      "id, company_id, lead_id, ai_status, ai_handling, human_takeover_at, lead_temperature, last_message_at",
    )
    .eq("id", conversationId)
    .maybeSingle();

  if (!conv || conv.company_id !== companyId) {
    return { eligible: false, blockedReason: "conversa não encontrada" };
  }
  if (!conv.lead_id) {
    return { eligible: false, blockedReason: "conversa sem lead associado" };
  }

  // Bloqueios mínimos (segurança, mesmo no modo manual)
  if (conv.ai_status === "assumido_humano" || conv.human_takeover_at) {
    return { eligible: false, blockedReason: "atendimento assumido por humano" };
  }
  if (conv.ai_status === "desinteresse") {
    return { eligible: false, blockedReason: "cliente marcado como sem interesse" };
  }
  if (conv.ai_handling) {
    return { eligible: false, blockedReason: "IA está processando uma resposta agora" };
  }

  // Anti spam mínimo: mensagem do agente nos últimos 30 segundos
  const recentCutoff = new Date(Date.now() - 30 * 1000).toISOString();
  const { data: veryRecent } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("conversation_id", conv.id)
    .eq("role", "agent")
    .gte("at", recentCutoff)
    .limit(1);
  if (veryRecent && veryRecent.length > 0) {
    return { eligible: false, blockedReason: "mensagem do agente enviada há menos de 30s" };
  }

  // Regra: temperatura quente > silent (manual sempre permite)
  const rule: "hot_lead_idle" | "lead_silent" =
    (conv.lead_temperature ?? "").toLowerCase() === "quente" ? "hot_lead_idle" : "lead_silent";

  const { data: prior } = await supabaseAdmin
    .from("follow_ups")
    .select("id")
    .eq("company_id", companyId)
    .eq("lead_id", conv.lead_id);
  const attempt = (prior?.length ?? 0) + 1;

  // Referência para "o cliente respondeu": a última mensagem dele agora.
  const { data: lastLead } = await supabaseAdmin
    .from("messages")
    .select("at")
    .eq("company_id", companyId)
    .eq("conversation_id", conv.id)
    .eq("role", "lead")
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const candidate: Candidate = {
    conversationId: conv.id,
    leadId: conv.lead_id,
    rule,
    lastClientMessageAt: (lastLead as { at?: string } | null)?.at ?? null,
    signal: "manual",
  };
  const v2 = await getFollowupV2Settings(companyId).catch(() => null);
  const built = await buildMessage(candidate, settings, attempt, v2?.humanize ?? false);

  const r = await dispatchFollowup({
    companyId,
    conversationId: conv.id,
    leadId: conv.lead_id,
    rule,
    attempt,
    text: built.text,
    outsideWindow: await isOutsideWhatsappWindow(conv.id),
    signal: candidate.signal,
    referenceAt: candidate.lastClientMessageAt,
    trigger: { kind: "manual", userId },
  });

  if (r.status === "skipped") {
    return { eligible: false, blockedReason: r.reason };
  }

  try {
    await supabaseAdmin.from("audit_log").insert({
      company_id: companyId,
      user_id: userId,
      action: `manual_followup_${r.status}`,
      entity: "follow_up_manual",
      entity_id: conv.id,
      after: {
        rule,
        via: r.via,
        template_name: r.templateName ?? null,
        resume_phrase: r.resumePhrase ?? null,
        error: r.error ?? r.reason ?? null,
        simulated: r.status === "simulated",
      } as never,
    });
  } catch {
    /* auditoria é best-effort */
  }

  return {
    eligible: true,
    rule,
    generatedMessage: r.message,
    sendStatus: r.status,
    sendError: r.status === "blocked" ? r.reason : r.error,
    externalId: r.status === "sent" ? (r.externalId ?? null) : null,
    simulated: r.status === "simulated",
    simulationId: r.status === "simulated" ? (r.simulationId ?? null) : null,
    via: r.via,
  };
}
