// ============================================================================
// followup/reactivation.ts
// Responsabilidade: reativação opt-in de leads antigos que não estão fechados
// nem perdidos. Respeita horário próprio (v2), gate global e limite diário
// da reativação. Reutiliza `humanizeTemplate` e `sendWhatsappText`.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { humanizeTemplate } from "./humanizer";
import { canSendFollowupNow } from "./gates";
import { getFollowupV2Settings } from "./settings";
import type { ReactivationResult } from "./types";

function withinTimeWindow(start: string, end: string, now = new Date()): boolean {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= sh * 60 + (sm || 0) && mins <= eh * 60 + (em || 0);
}

export async function runReactivation(companyId: string): Promise<ReactivationResult> {
  const out: ReactivationResult = { scanned: 0, sent: 0, simulated: 0, skipped: [] };
  try {
    const v2 = await getFollowupV2Settings(companyId);
    if (!v2 || !v2.reactivationEnabled) return out;
    if (!withinTimeWindow(v2.reactivationHoursStart, v2.reactivationHoursEnd)) {
      out.skipped.push({ leadId: "-", reason: "fora do horário de reativação" });
      return out;
    }
    const gate = await canSendFollowupNow(companyId);
    if (!gate.ok) {
      out.skipped.push({ leadId: "-", reason: gate.reason ?? "gate" });
      return out;
    }
    const cutoff = new Date(
      Date.now() - v2.reactivationDays * 24 * 3600 * 1000,
    ).toISOString();
    const { data: leads } = await supabaseAdmin
      .from("leads")
      .select("id, name, phone, updated_at")
      .eq("company_id", companyId)
      .lt("updated_at", cutoff)
      .is("reactivated_at" as never, null)
      .not("status", "in", "(fechado,perdido)")
      .limit(v2.reactivationDailyMax);
    out.scanned = leads?.length ?? 0;

    // Import on-demand para evitar ciclo com ai-agent.server
    const { sendWhatsappText } = await import("@/lib/ai-agent.server");

    for (const lead of leads ?? []) {
      try {
        const { data: conv } = await supabaseAdmin
          .from("conversations")
          .select("id")
          .eq("lead_id", lead.id)
          .order("last_message_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!conv) {
          out.skipped.push({ leadId: lead.id, reason: "sem conversa" });
          continue;
        }

        // Dedupe de simulações: se já houve uma tentativa simulada de
        // reativação para este lead dentro da janela reactivationDays, não
        // reeleger (evita disparos duplicados em staging enquanto o guard
        // estiver ON — em production/legacy nunca haverá registro simulated).
        const simCutoff = new Date(
          Date.now() - v2.reactivationDays * 24 * 3600 * 1000,
        ).toISOString();
        const { data: prevSim } = await supabaseAdmin
          .from("follow_ups")
          .select("id")
          .eq("company_id", companyId)
          .eq("lead_id", lead.id)
          .eq("rule_type", "returning_customer")
          .eq("status", "simulated")
          .gte("created_at", simCutoff)
          .limit(1);
        if (prevSim && prevSim.length > 0) {
          out.skipped.push({ leadId: lead.id, reason: "reativação já simulada" });
          continue;
        }

        const nome = (lead.name || "").trim().split(/\s+/)[0] || "tudo bem";
        const seed = Math.floor(Date.now() / 1000) + lead.id.charCodeAt(0);
        const { text, variant } = humanizeTemplate(
          v2.reactivationTemplate.replace(/\{\{nome\}\}/g, nome),
          1,
          seed,
          { nome },
        );
        const send = await sendWhatsappText({
          companyId,
          conversationId: conv.id,
          leadId: lead.id,
          text,
        });
        if (!send.ok) {
          out.skipped.push({ leadId: lead.id, reason: send.error ?? "envio falhou" });
          continue;
        }
        if (send.simulated) {
          // Registra tentativa simulada com status distinto — NÃO marca
          // leads.reactivated_at (não conta como reativação real).
          await supabaseAdmin.from("follow_ups").insert({
            company_id: companyId,
            conversation_id: conv.id,
            lead_id: lead.id,
            rule_type: "returning_customer",
            attempt_number: 1,
            message_text: text,
            status: "simulated",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            variant_seed: variant,
            trigger_reason: `Reativação (simulada): lead parado há mais de ${v2.reactivationDays} dias`,
            metadata: {
              signal: "reactivation",
              via: "text",
              simulated: true,
              simulation_id: send.simulationId,
              external_request_sent: false,
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);
          out.simulated = (out.simulated ?? 0) + 1;
          continue;
        }
        await supabaseAdmin.from("follow_ups").insert({
          company_id: companyId,
          conversation_id: conv.id,
          lead_id: lead.id,
          rule_type: "returning_customer",
          attempt_number: 1,
          message_text: text,
          status: "sent",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          variant_seed: variant,
          trigger_reason: `Reativação: lead parado há mais de ${v2.reactivationDays} dias`,
          metadata: { signal: "reactivation", via: "text", external_id: send.externalId },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        await supabaseAdmin
          .from("leads")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update({ reactivated_at: new Date().toISOString() } as any)
          .eq("id", lead.id);
        out.sent++;
      } catch (e) {
        out.skipped.push({
          leadId: lead.id,
          reason: e instanceof Error ? e.message : "erro",
        });
      }
    }
  } catch (e) {
    out.skipped.push({
      leadId: "-",
      reason: e instanceof Error ? e.message : "erro",
    });
  }
  return out;
}
