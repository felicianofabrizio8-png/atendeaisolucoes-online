// ============================================================================
// followup/manual.ts
// Responsabilidade: "Follow-up agora" — um admin antecipa a próxima tentativa
// do ciclo de negociação da conversa. Chamado pela server function
// `runFollowupNowForConversation` (src/lib/manual-followup.functions.ts).
//
// Mesmo motor do tick: o ciclo ativo (ou um aberto agora pelas mesmas regras
// de detecção) recebe a próxima tentativa já, via `dispatch.ts`, e o
// resultado reagenda/encerra o ciclo normalmente. Só não espera o relógio.
// Cliente esperando resposta não é follow-up: é pendência de atendimento.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";

import { calendarFor } from "./calendar";
import { classifyConversation } from "./candidates";
import {
  activeCycleFor,
  applyDispatchOutcome,
  openCycle,
  type CycleContext,
  type CycleRow,
} from "./cycles";
import { dispatchFollowup } from "./dispatch";
import { buildMessage } from "./message";
import { isOutsideWhatsappWindow } from "./safety";
import { getFollowupSettings, getFollowupV2Settings } from "./settings";
import type { ManualFollowupResult } from "./types";

export interface ManualFollowupInput {
  companyId: string;
  userId: string;
  conversationId: string;
}

export async function runManualFollowup(input: ManualFollowupInput): Promise<ManualFollowupResult> {
  const { companyId, userId, conversationId } = input;
  const now = new Date();

  const [settings, v2] = await Promise.all([
    getFollowupSettings(companyId),
    getFollowupV2Settings(companyId),
  ]);
  if (!settings || !v2) {
    return { eligible: false, blockedReason: "configuração de follow-up não encontrada" };
  }

  const { data: conv } = await supabaseAdmin
    .from("conversations")
    .select("id, company_id, lead_id, ai_status, ai_handling, human_takeover_at, lead_temperature")
    .eq("company_id", companyId)
    .eq("id", conversationId)
    .maybeSingle();

  if (!conv || conv.company_id !== companyId) {
    return { eligible: false, blockedReason: "conversa não encontrada" };
  }
  if (!conv.lead_id) {
    return { eligible: false, blockedReason: "conversa sem lead associado" };
  }
  if (conv.ai_handling) {
    return { eligible: false, blockedReason: "IA está processando uma resposta agora" };
  }

  // Anti spam mínimo: mensagem do agente nos últimos 30 segundos
  const recentCutoff = new Date(now.getTime() - 30 * 1000).toISOString();
  const { data: veryRecent } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("company_id", companyId)
    .eq("conversation_id", conv.id)
    .eq("role", "agent")
    .gte("at", recentCutoff)
    .limit(1);
  if (veryRecent && veryRecent.length > 0) {
    return { eligible: false, blockedReason: "mensagem do agente enviada há menos de 30s" };
  }

  const ctx: CycleContext = {
    settings,
    calendar: calendarFor(settings),
    jitterMinutes: v2.delayJitterMinutes,
    now,
  };

  const cls = await classifyConversation(companyId, conv, now);
  let cycle: CycleRow | null = null;
  if (cls.kind === "pending_attendance") {
    return {
      eligible: false,
      blockedReason:
        "o cliente está esperando resposta — isso é atendimento pendente, não follow-up",
    };
  }
  if (cls.kind === "none") return { eligible: false, blockedReason: cls.reason };
  if (cls.kind === "active") cycle = await activeCycleFor(companyId, conv.id);
  if (cls.kind === "candidate") {
    cycle =
      (await openCycle(companyId, cls.candidate, ctx)) ??
      (await activeCycleFor(companyId, conv.id));
  }
  if (!cycle)
    return { eligible: false, blockedReason: "não foi possível abrir o ciclo de follow-up" };

  const attempt = cycle.attempts + 1;
  const signal = String(cycle.metadata?.signal ?? cycle.reason);
  const built = await buildMessage(
    {
      conversationId: cycle.conversation_id,
      leadId: cycle.lead_id,
      rule: cycle.reason,
      referenceKey: cycle.reference_key,
      referenceAt: cycle.reference_at,
      signal,
    },
    settings,
    attempt,
    v2.humanize,
  );

  const r = await dispatchFollowup({
    companyId,
    conversationId: conv.id,
    leadId: conv.lead_id,
    rule: cycle.reason,
    attempt,
    text: built.text,
    outsideWindow: await isOutsideWhatsappWindow(conv.id),
    signal,
    referenceAt: cycle.reference_at,
    trigger: { kind: "manual", userId },
    cycleId: cycle.id,
  });
  const applied = await applyDispatchOutcome(cycle, r, ctx);

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
        rule: cycle.reason,
        cycle_id: cycle.id,
        attempt,
        via: r.via,
        template_name: r.templateName ?? null,
        resume_phrase: r.resumePhrase ?? null,
        next_followup_at: applied.nextFollowupAt ?? null,
        cycle_closed: applied.closeReason ?? null,
        error: r.error ?? r.reason ?? null,
        simulated: r.status === "simulated",
      } as never,
    });
  } catch {
    /* auditoria é best-effort */
  }

  return {
    eligible: true,
    rule: cycle.reason,
    generatedMessage: r.message,
    sendStatus: r.status,
    sendError: r.status === "blocked" ? r.reason : r.error,
    externalId: r.status === "sent" ? (r.externalId ?? null) : null,
    simulated: r.status === "simulated",
    simulationId: r.status === "simulated" ? (r.simulationId ?? null) : null,
    via: r.via,
    attempt,
    nextFollowupAt: applied.nextFollowupAt ?? null,
    cycleClosedReason: applied.closeReason ?? null,
  };
}
