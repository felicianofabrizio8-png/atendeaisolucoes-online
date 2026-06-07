// ============================================================================
// Manual Follow-up — execução pontual disparada pelo admin.
// Reaproveita templates/sender do tick automático, mas IGNORA temporariamente
// as janelas de tempo configuradas (cutoffs, business hours, minHoursBetween,
// maxPerLead). Mantém apenas as proteções essenciais (handoff humano,
// desinteresse, IA processando, mensagem recente do agente nos últimos 30s).
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ conversationId: z.string().uuid() });

export type ManualFollowupResult = {
  eligible: boolean;
  blockedReason?: string;
  rule?: string;
  generatedMessage?: string;
  sendStatus?: "sent" | "failed" | "blocked";
  sendError?: string;
  externalId?: string | null;
  via?: "text" | "template";
};

export const runFollowupNowForConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<ManualFollowupResult> => {
    const { supabase, userId } = context as {
      supabase: {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              col: string,
              v: string,
            ) => { maybeSingle: () => Promise<{ data: { company_id: string } | null }> };
          };
        };
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: boolean | null }>;
      };
      userId: string;
    };

    // 1) Confere admin da empresa atual
    const { data: prof } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    if (!prof?.company_id) throw new Error("Usuário sem empresa.");
    const companyId = prof.company_id;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _company_id: companyId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Apenas administradores podem executar.");

    // 2) Carrega serviços server-only
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { getFollowupSettings } = await import("@/lib/ai-followup.server");
    const { getFollowupV2Settings, humanizeTemplate } = await import(
      "@/lib/ai-followup-v2.server"
    );
    const { sendWhatsappText } = await import("@/lib/ai-agent.server");
    const {
      findApprovedTemplateForPurpose,
      sendWhatsappTemplate,
    } = await import("@/lib/wa-templates.server");

    const settings = await getFollowupSettings(companyId);
    if (!settings) {
      return { eligible: false, blockedReason: "configuração de follow-up não encontrada" };
    }

    // 3) Conversa precisa pertencer à empresa
    const { data: conv } = await supabaseAdmin
      .from("conversations")
      .select(
        "id, company_id, lead_id, ai_status, ai_handling, human_takeover_at, lead_temperature, last_message_at",
      )
      .eq("id", data.conversationId)
      .maybeSingle();

    if (!conv || conv.company_id !== companyId) {
      return { eligible: false, blockedReason: "conversa não encontrada" };
    }
    if (!conv.lead_id) {
      return { eligible: false, blockedReason: "conversa sem lead associado" };
    }

    // 4) Bloqueios mínimos (segurança, mesmo no modo manual)
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

    // 5) Define regra: temperatura quente > silent (manual sempre permite)
    const rule: "hot_lead_idle" | "lead_silent" =
      (conv.lead_temperature ?? "").toLowerCase() === "quente"
        ? "hot_lead_idle"
        : "lead_silent";

    // 6) Conta tentativa
    const { data: prior } = await supabaseAdmin
      .from("follow_ups")
      .select("id")
      .eq("company_id", companyId)
      .eq("lead_id", conv.lead_id);
    const attempt = (prior?.length ?? 0) + 1;

    // 7) Gera mensagem
    const v2 = await getFollowupV2Settings(companyId).catch(() => null);
    const humanize = v2?.humanize ?? false;
    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("name, product, phone, external_id")
      .eq("id", conv.lead_id)
      .maybeSingle();
    const firstName = (lead?.name ?? "").trim().split(/\s+/)[0] || "tudo bem";
    const tpl = settings.templates[rule];
    const baseText = tpl
      .replace(/\{\{nome\}\}/g, firstName)
      .replace(/\{\{produto\}\}/g, lead?.product ?? "")
      .replace(/\{\{agente\}\}/g, settings.agentName);
    const text = humanize
      ? humanizeTemplate(baseText, attempt, Math.floor(Date.now() / 60000)).text
      : baseText;

    // 8) Detecta janela 24h
    const cutoff24 = new Date(Date.now() - 23 * 3600 * 1000).toISOString();
    const { data: clientMsg } = await supabaseAdmin
      .from("messages")
      .select("id")
      .eq("conversation_id", conv.id)
      .eq("role", "lead")
      .gte("at", cutoff24)
      .limit(1);
    const outsideWindow = !clientMsg || clientMsg.length === 0;

    // Helper de audit
    const writeAudit = async (action: string, after: Record<string, unknown>) => {
      try {
        await supabaseAdmin.from("audit_log").insert({
          company_id: companyId,
          user_id: userId,
          action,
          entity: "follow_up_manual",
          entity_id: conv.id,
          after,
        });
      } catch {
        /* noop */
      }
    };

    // 9) Envio
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
      const vars: Record<string, string> = {};
      (template.variables ?? []).forEach((v, i) => {
        vars[v] = i === 0 ? firstName : "";
      });
      const tplSend = await sendWhatsappTemplate({
        companyId,
        conversationId: conv.id,
        leadId: conv.lead_id,
        purpose: rule,
        variables: vars,
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
        { rule, via: "template", template_name: template.name, error: tplSend.ok ? null : tplSend.error },
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
  });
