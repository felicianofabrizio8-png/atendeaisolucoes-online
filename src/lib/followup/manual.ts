// ============================================================================
// followup/manual.ts
// Responsabilidade: núcleo do disparo manual de follow-up executado por um
// administrador via inbox. É chamado pela server function
// `runFollowupNowForConversation` (mantida por compatibilidade em
// src/lib/manual-followup.functions.ts). Ignora janelas de tempo, mas
// mantém proteções essenciais (handoff humano, desinteresse, spam 30s).
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsappText } from "@/lib/ai-agent.server";
import {
  findApprovedTemplateForPurpose,
  sendWhatsappTemplate,
} from "@/lib/wa-templates.server";

import { firstName } from "./defaults";
import { humanizeTemplate } from "./humanizer";
import { getFollowupSettings, getFollowupV2Settings } from "./settings";
import type { ManualFollowupResult } from "./types";

export interface ManualFollowupInput {
  companyId: string;
  userId: string;
  conversationId: string;
}

export async function runManualFollowup(
  input: ManualFollowupInput,
): Promise<ManualFollowupResult> {
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
    (conv.lead_temperature ?? "").toLowerCase() === "quente"
      ? "hot_lead_idle"
      : "lead_silent";

  const { data: prior } = await supabaseAdmin
    .from("follow_ups")
    .select("id")
    .eq("company_id", companyId)
    .eq("lead_id", conv.lead_id);
  const attempt = (prior?.length ?? 0) + 1;

  // Mensagem
  const v2 = await getFollowupV2Settings(companyId).catch(() => null);
  const humanize = v2?.humanize ?? false;
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("name, product, phone, external_id")
    .eq("id", conv.lead_id)
    .maybeSingle();
  const firstNameStr = firstName(lead?.name);
  const tpl = settings.templates[rule];
  const vars: Record<string, string> = {
    nome: firstNameStr,
    produto: lead?.product ?? "",
    agente: settings.agentName,
  };
  const baseText = tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
  const text = humanize
    ? humanizeTemplate(baseText, attempt, Math.floor(Date.now() / 60000), vars).text
    : baseText;

  // Janela 24h
  const cutoff24 = new Date(Date.now() - 23 * 3600 * 1000).toISOString();
  const { data: clientMsg } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("conversation_id", conv.id)
    .eq("role", "lead")
    .gte("at", cutoff24)
    .limit(1);
  const outsideWindow = !clientMsg || clientMsg.length === 0;

  const writeAudit = async (action: string, after: Record<string, unknown>) => {
    try {
      await supabaseAdmin.from("audit_log").insert({
        company_id: companyId,
        user_id: userId,
        action,
        entity: "follow_up_manual",
        entity_id: conv.id,
        after: after as never,
      });
    } catch {
      /* noop */
    }
  };

  // Envio fora da janela: template Utility aprovado
  if (outsideWindow) {
    const template = await findApprovedTemplateForPurpose(companyId, rule);
    if (!template) {
      await supabaseAdmin.from("follow_ups").insert({
        company_id: companyId,
        conversation_id: conv.id,
        lead_id: conv.lead_id,
        rule_type: rule,
        attempt_number: attempt,
        message_text: text,
        status: "blocked",
        trigger_reason: "manual_admin",
        metadata: { manual: true, reason: "template_missing", by: userId },
      });
      await writeAudit("manual_followup_blocked", {
        rule,
        reason: "fora da janela 24h e sem template aprovado",
      });
      return {
        eligible: true,
        rule,
        generatedMessage: text,
        sendStatus: "blocked",
        sendError: "fora da janela 24h e sem template aprovado",
        via: "template",
      };
    }
    const tvars: Record<string, string> = {};
    (template.variables ?? []).forEach((v, i) => {
      tvars[v] = i === 0 ? firstNameStr : "";
    });
    const tplSend = await sendWhatsappTemplate({
      companyId,
      conversationId: conv.id,
      leadId: conv.lead_id,
      purpose: rule,
      variables: tvars,
      source: "followup_template",
    });
    const status = tplSend.ok ? "sent" : "failed";
    await supabaseAdmin.from("follow_ups").insert({
      company_id: companyId,
      conversation_id: conv.id,
      lead_id: conv.lead_id,
      rule_type: rule,
      attempt_number: attempt,
      message_text: text,
      status,
      trigger_reason: "manual_admin",
      metadata: {
        manual: true,
        by: userId,
        via: "template",
        template_name: template.name,
        ...(tplSend.ok
          ? { external_id: tplSend.externalId }
          : { error: tplSend.error }),
      },
    });
    await writeAudit(
      tplSend.ok ? "manual_followup_sent" : "manual_followup_failed",
      {
        rule,
        via: "template",
        template_name: template.name,
        error: tplSend.ok ? null : tplSend.error,
      },
    );
    return {
      eligible: true,
      rule,
      generatedMessage: text,
      sendStatus: status,
      sendError: tplSend.ok ? undefined : tplSend.error,
      externalId: tplSend.ok ? tplSend.externalId : null,
      via: "template",
    };
  }

  // Dentro da janela: texto livre
  const send = await sendWhatsappText({
    companyId,
    conversationId: conv.id,
    leadId: conv.lead_id,
    text,
  });
  const status = send.ok ? "sent" : "failed";
  await supabaseAdmin.from("follow_ups").insert({
    company_id: companyId,
    conversation_id: conv.id,
    lead_id: conv.lead_id,
    rule_type: rule,
    attempt_number: attempt,
    message_text: text,
    status,
    trigger_reason: "manual_admin",
    metadata: {
      manual: true,
      by: userId,
      via: "text",
      ...(send.ok ? { external_id: send.externalId } : { error: send.error }),
    },
  });
  await writeAudit(
    send.ok ? "manual_followup_sent" : "manual_followup_failed",
    { rule, via: "text", error: send.ok ? null : send.error },
  );
  return {
    eligible: true,
    rule,
    generatedMessage: text,
    sendStatus: status,
    sendError: send.ok ? undefined : send.error,
    externalId: send.ok ? send.externalId : null,
    via: "text",
  };
}
