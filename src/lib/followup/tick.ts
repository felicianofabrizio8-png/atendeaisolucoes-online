// ============================================================================
// followup/tick.ts
// Responsabilidade: loop principal do follow-up automático.
// Aplica os gates (readiness, horário, v2), busca candidatos, valida cada um
// e envia via texto (dentro da janela 24h) ou template Utility (fora dela).
// Persiste em follow_ups e ai_flow_events.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsappText } from "@/lib/ai-agent.server";
import { getReadiness } from "@/lib/ai-readiness.server";
import {
  findApprovedTemplateForPurpose,
  sendWhatsappTemplate,
  type TemplatePurpose,
} from "@/lib/wa-templates.server";

import { findCandidates } from "./candidates";
import { firstName, isWithinBusinessHours } from "./defaults";
import { canSendFollowupNow } from "./gates";
import { buildMessage } from "./message";
import { canSend } from "./safety";
import { getFollowupSettings, getFollowupV2Settings } from "./settings";
import type { TickResult } from "./types";

export async function runFollowupTickForCompany(
  companyId: string,
): Promise<TickResult> {
  const result: TickResult = {
    companyId,
    scanned: 0,
    sent: 0,
    simulated: 0,
    skipped: [],
    errors: [],
  };
  const s = await getFollowupSettings(companyId);
  if (!s) return result;
  if (!s.enabled) return result;

  // Guard do piloto: só roda se IA estiver em "ativa" ou "piloto".
  const readiness = await getReadiness(companyId);
  if (readiness.status !== "ativa" && readiness.status !== "piloto") {
    result.errors.push(`bloqueado pelo piloto: status=${readiness.status}`);
    return result;
  }

  if (!isWithinBusinessHours(s)) {
    result.errors.push("fora do horário comercial");
    return result;
  }

  // Gate v2 (limite diário, taxa de resposta, warmup, integração ativa).
  const v2Gate = await canSendFollowupNow(companyId).catch(
    () => ({ ok: true as const, reason: undefined as string | undefined }),
  );
  if (!v2Gate.ok) {
    result.errors.push(`gate v2: ${("reason" in v2Gate && v2Gate.reason) || "bloqueado"}`);
    return result;
  }

  const v2 = await getFollowupV2Settings(companyId).catch(() => null);
  const humanize = v2?.humanize ?? false;

  const candidates = await findCandidates(companyId, s);
  result.scanned = candidates.length;

  for (const c of candidates) {
    const check = await canSend(companyId, c, s);
    if (!check.ok) {
      result.skipped.push({
        conversationId: c.conversationId,
        rule: c.rule,
        reason: check.reason ?? "indisponível",
      });
      continue;
    }
    const attempt = check.attempt ?? 1;
    const built = await buildMessage(c, s, attempt, humanize);
    const text = built.text;

    // ---- Fora da janela de 24h: tenta template Utility aprovado ----
    if (check.outsideWindow) {
      const purpose = c.rule as TemplatePurpose;
      const template = await findApprovedTemplateForPurpose(companyId, purpose);
      if (!template) {
        await supabaseAdmin.from("follow_ups").insert({
          company_id: companyId,
          conversation_id: c.conversationId,
          lead_id: c.leadId,
          rule_type: c.rule,
          attempt_number: attempt,
          message_text: text,
          status: "blocked",
          metadata: { signal: c.signal, reason: "template_missing", purpose },
        });
        await supabaseAdmin.from("ai_flow_events").insert({
          company_id: companyId,
          conversation_id: c.conversationId,
          lead_id: c.leadId,
          event_type: "template_missing",
          payload: { rule: c.rule, purpose, signal: c.signal },
        });
        result.skipped.push({
          conversationId: c.conversationId,
          rule: c.rule,
          reason: "fora da janela 24h e sem template aprovado",
        });
        continue;
      }
      const { data: lead } = await supabaseAdmin
        .from("leads")
        .select("name")
        .eq("id", c.leadId)
        .maybeSingle();
      const nome = firstName(lead?.name);
      const vars: Record<string, string> = {};
      (template.variables ?? []).forEach((v, i) => {
        vars[v] = i === 0 ? nome : "";
      });
      const tplSend = await sendWhatsappTemplate({
        companyId,
        conversationId: c.conversationId,
        leadId: c.leadId,
        purpose,
        variables: vars,
        source: "followup_template",
      });
      if (!tplSend.ok) {
        await supabaseAdmin.from("follow_ups").insert({
          company_id: companyId,
          conversation_id: c.conversationId,
          lead_id: c.leadId,
          rule_type: c.rule,
          attempt_number: attempt,
          message_text: text,
          status: "failed",
          metadata: {
            signal: c.signal,
            error: tplSend.error,
            via: "template",
            template_name: template.name,
          },
        });
        result.errors.push(`${c.rule} (template): ${tplSend.error}`);
        continue;
      }
      await supabaseAdmin.from("follow_ups").insert({
        company_id: companyId,
        conversation_id: c.conversationId,
        lead_id: c.leadId,
        rule_type: c.rule,
        attempt_number: attempt,
        message_text: text,
        status: "sent",
        metadata: {
          signal: c.signal,
          external_id: tplSend.externalId,
          via: "template",
          template_name: template.name,
          category: template.category,
        },
      });
      await supabaseAdmin.from("ai_flow_events").insert({
        company_id: companyId,
        conversation_id: c.conversationId,
        lead_id: c.leadId,
        event_type: "followup_sent",
        payload: {
          rule: c.rule,
          attempt,
          signal: c.signal,
          via: "template",
          template_name: template.name,
        },
      });
      result.sent++;
      continue;
    }

    // ---- Dentro da janela: envio normal de texto ----
    const send = await sendWhatsappText({
      companyId,
      conversationId: c.conversationId,
      leadId: c.leadId,
      text,
    });
    if (!send.ok) {
      await supabaseAdmin.from("follow_ups").insert({
        company_id: companyId,
        conversation_id: c.conversationId,
        lead_id: c.leadId,
        rule_type: c.rule,
        attempt_number: attempt,
        message_text: text,
        status: "failed",
        metadata: { signal: c.signal, error: send.error },
      });
      await supabaseAdmin.from("ai_flow_events").insert({
        company_id: companyId,
        conversation_id: c.conversationId,
        lead_id: c.leadId,
        event_type: "followup_failed",
        payload: { rule: c.rule, error: send.error },
      });
      result.errors.push(`${c.rule}: ${send.error}`);
      continue;
    }
    // Simulação: NÃO conta como sent real. Persiste follow_up com
    // status='simulated' e metadata.simulated=true — o candidato entra no
    // count de safety.canSend (attempts) e no minHoursBetween, o que impede
    // reenvio automático imediato sem inflar métricas de "enviados".
    if (send.simulated) {
      await supabaseAdmin.from("follow_ups").insert({
        company_id: companyId,
        conversation_id: c.conversationId,
        lead_id: c.leadId,
        rule_type: c.rule,
        attempt_number: attempt,
        message_text: text,
        status: "simulated",
        metadata: {
          signal: c.signal,
          simulated: true,
          simulation_id: send.simulationId,
          external_request_sent: false,
        },
      });
      await supabaseAdmin.from("ai_flow_events").insert({
        company_id: companyId,
        conversation_id: c.conversationId,
        lead_id: c.leadId,
        event_type: "followup_simulated",
        payload: {
          rule: c.rule,
          attempt,
          signal: c.signal,
          simulation_id: send.simulationId,
        },
      });
      result.simulated = (result.simulated ?? 0) + 1;
      continue;
    }
    await supabaseAdmin.from("follow_ups").insert({
      company_id: companyId,
      conversation_id: c.conversationId,
      lead_id: c.leadId,
      rule_type: c.rule,
      attempt_number: attempt,
      message_text: text,
      status: "sent",
      metadata: { signal: c.signal, external_id: send.externalId },
    });
    await supabaseAdmin.from("ai_flow_events").insert({
      company_id: companyId,
      conversation_id: c.conversationId,
      lead_id: c.leadId,
      event_type: "followup_sent",
      payload: { rule: c.rule, attempt, signal: c.signal },
    });
    result.sent++;
  }

  return result;
}

export async function runFollowupTickAll(): Promise<TickResult[]> {
  const { data: companies } = await supabaseAdmin
    .from("company_settings")
    .select("company_id")
    .eq("ai_followup_enabled", true);
  const results: TickResult[] = [];
  for (const c of companies ?? []) {
    try {
      results.push(await runFollowupTickForCompany(c.company_id));
    } catch (e) {
      results.push({
        companyId: c.company_id,
        scanned: 0,
        sent: 0,
        skipped: [],
        errors: [e instanceof Error ? e.message : "erro"],
      });
    }
  }
  return results;
}
