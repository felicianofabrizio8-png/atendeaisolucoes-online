// ============================================================================
// followup/reactivation.ts
// Responsabilidade: reativação opt-in de leads antigos que não estão fechados
// nem perdidos. Separada dos ciclos de negociação (acionada pelo painel), mas
// envia pelo motor único (`dispatch.ts`): lead parado há semanas está sempre
// fora da janela de 24h, então sai por template aprovado — `chamar_novamente`
// com retomada contextual ou o legado `reativacao_cliente`. Texto livre fora
// da janela é recusado pela Meta.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { calendarFor, isBusinessTime, startOfZonedDay } from "./calendar";
import { dispatchFollowup } from "./dispatch";
import { canSendFollowupNow } from "./gates";
import { humanizeTemplate } from "./humanizer";
import { isOutsideWhatsappWindow } from "./safety";
import { getFollowupSettings, getFollowupV2Settings } from "./settings";
import type { ReactivationResult } from "./types";

const REACTIVATION_TRIGGER = "reactivation";

export async function runReactivation(
  companyId: string,
  now = new Date(),
): Promise<ReactivationResult> {
  const out: ReactivationResult = { scanned: 0, sent: 0, simulated: 0, skipped: [] };
  try {
    const [v1, v2] = await Promise.all([
      getFollowupSettings(companyId),
      getFollowupV2Settings(companyId),
    ]);
    if (!v1 || !v2 || !v2.reactivationEnabled) return out;
    // Janela própria da reativação, no fuso e nos dias úteis da empresa.
    const cal = {
      ...calendarFor(v1),
      start: v2.reactivationHoursStart,
      end: v2.reactivationHoursEnd,
      businessHoursOnly: true,
    };
    if (!isBusinessTime(now, cal)) {
      out.skipped.push({ leadId: "-", reason: "fora do horário de reativação" });
      return out;
    }
    const gate = await canSendFollowupNow(companyId, now);
    if (!gate.ok) {
      out.skipped.push({ leadId: "-", reason: gate.reason ?? "gate" });
      return out;
    }

    // "Máximo por dia" de verdade: conta as reativações de hoje, não o lote.
    const { count: doneToday } = await supabaseAdmin
      .from("follow_ups")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("trigger_reason", REACTIVATION_TRIGGER)
      .in("status", ["sent", "simulated", "responded", "recovered"])
      .gte("sent_at", startOfZonedDay(now, v1.timeZone).toISOString());
    const room = Math.min(
      v2.reactivationDailyMax - (doneToday ?? 0),
      gate.remainingToday ?? Infinity,
    );
    if (room <= 0) {
      out.skipped.push({ leadId: "-", reason: "limite diário de reativação atingido" });
      return out;
    }

    const cutoff = new Date(now.getTime() - v2.reactivationDays * 24 * 3600 * 1000).toISOString();
    const { data: leads } = await supabaseAdmin
      .from("leads")
      .select("id, name, phone, updated_at")
      .eq("company_id", companyId)
      .lt("updated_at", cutoff)
      .is("reactivated_at" as never, null)
      .not("status", "in", "(fechado,perdido)")
      .limit(room);
    out.scanned = leads?.length ?? 0;

    for (const lead of leads ?? []) {
      try {
        const { data: conv } = await supabaseAdmin
          .from("conversations")
          .select("id")
          .eq("company_id", companyId)
          .eq("lead_id", lead.id)
          .order("last_message_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!conv) {
          out.skipped.push({ leadId: lead.id, reason: "sem conversa" });
          continue;
        }

        // Negociação em curso tem ciclo próprio: reativação não se mete.
        const { data: activeCycle } = await supabaseAdmin
          .from("followup_cycles")
          .select("id")
          .eq("company_id", companyId)
          .eq("conversation_id", conv.id)
          .eq("state", "active")
          .limit(1);
        if (activeCycle && activeCycle.length > 0) {
          out.skipped.push({ leadId: lead.id, reason: "negociação com ciclo ativo" });
          continue;
        }

        // Dedupe de simulações: em staging (guard ON) não reeleger o mesmo
        // lead a cada clique — em produção nunca há registro simulated.
        const { data: prevSim } = await supabaseAdmin
          .from("follow_ups")
          .select("id")
          .eq("company_id", companyId)
          .eq("lead_id", lead.id)
          .eq("rule_type", "returning_customer")
          .eq("status", "simulated")
          .gte("created_at", cutoff)
          .limit(1);
        if (prevSim && prevSim.length > 0) {
          out.skipped.push({ leadId: lead.id, reason: "reativação já simulada" });
          continue;
        }

        const { data: lastLead } = await supabaseAdmin
          .from("messages")
          .select("at")
          .eq("company_id", companyId)
          .eq("conversation_id", conv.id)
          .eq("role", "lead")
          .order("at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const nome = (lead.name || "").trim().split(/\s+/)[0] || "tudo bem";
        const seed = Math.floor(now.getTime() / 1000) + lead.id.charCodeAt(0);
        const { text, variant } = humanizeTemplate(
          v2.reactivationTemplate.replace(/\{\{nome\}\}/g, nome),
          1,
          seed,
          { nome },
        );

        const r = await dispatchFollowup({
          companyId,
          conversationId: conv.id,
          leadId: lead.id,
          rule: "returning_customer",
          attempt: 1,
          text,
          outsideWindow: await isOutsideWhatsappWindow(conv.id),
          signal: "reactivation",
          referenceAt: (lastLead as { at?: string } | null)?.at ?? null,
          trigger: { kind: "reactivation", reason: REACTIVATION_TRIGGER, variantSeed: variant },
        });

        if (r.status === "sent") {
          await supabaseAdmin
            .from("leads")
            .update({ reactivated_at: now.toISOString() } as never)
            .eq("company_id", companyId)
            .eq("id", lead.id);
          out.sent++;
        } else if (r.status === "simulated") {
          // Não conta como reativação real: reactivated_at fica intacto.
          out.simulated = (out.simulated ?? 0) + 1;
        } else {
          out.skipped.push({ leadId: lead.id, reason: r.reason ?? r.error ?? r.status });
        }
      } catch (e) {
        out.skipped.push({ leadId: lead.id, reason: e instanceof Error ? e.message : "erro" });
      }
    }
  } catch (e) {
    out.skipped.push({ leadId: "-", reason: e instanceof Error ? e.message : "erro" });
  }
  return out;
}
