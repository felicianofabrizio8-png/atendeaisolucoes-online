// ============================================================================
// followup/tick.ts
// Responsabilidade: loop principal do follow-up automático, por ciclo de
// negociação.
//
//  1. guards: follow-up ligado + prontidão da IA;
//  2. abre ciclos para negociações novas sem resposta (não envia nada);
//  3. só no horário útil da empresa e com o gate global liberado:
//     processa os ciclos vencidos — reancora se a equipe falou de novo,
//     envia pelo motor único (`dispatch.ts`, que revalida) e aplica o
//     resultado ao ciclo (próxima data, encerramento).
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getReadiness } from "@/lib/ai-readiness.server";

import { calendarFor, isBusinessTime } from "./calendar";
import { scanFollowupOpportunities } from "./candidates";
import {
  applyDispatchOutcome,
  dueCycles,
  openCycle,
  reanchorIfWeSpokeAgain,
  type CycleContext,
} from "./cycles";
import { dispatchFollowup } from "./dispatch";
import { canSendFollowupNow } from "./gates";
import { buildMessage } from "./message";
import { isOutsideWhatsappWindow } from "./safety";
import { getFollowupSettings, getFollowupV2Settings } from "./settings";
import type { TickResult } from "./types";

/** Teto de ciclos processados por empresa em um tick. */
const MAX_DUE_PER_TICK = 25;

export async function runFollowupTickForCompany(
  companyId: string,
  now = new Date(),
): Promise<TickResult> {
  const result: TickResult = {
    companyId,
    scanned: 0,
    opened: 0,
    closed: 0,
    pendingAttendance: 0,
    sent: 0,
    simulated: 0,
    skipped: [],
    errors: [],
  };
  const s = await getFollowupSettings(companyId);
  if (!s || !s.enabled) return result;

  // Guard do piloto: só roda se IA estiver em "ativa" ou "piloto".
  const readiness = await getReadiness(companyId);
  if (readiness.status !== "ativa" && readiness.status !== "piloto") {
    result.errors.push(`bloqueado pelo piloto: status=${readiness.status}`);
    return result;
  }

  const v2 = await getFollowupV2Settings(companyId);
  if (!v2) {
    result.errors.push("configuração de follow-up v2 indisponível");
    return result;
  }
  const ctx: CycleContext = {
    settings: s,
    calendar: calendarFor(s),
    jitterMinutes: v2.delayJitterMinutes,
    now,
  };

  // Abrir ciclo não envia nada: roda a qualquer hora para o relógio da
  // negociação começar no momento certo.
  const scan = await scanFollowupOpportunities(companyId, s, { now });
  result.pendingAttendance = scan.pendingAttendance;
  for (const c of scan.candidates) {
    try {
      if (await openCycle(companyId, c, ctx)) result.opened = (result.opened ?? 0) + 1;
    } catch (e) {
      result.errors.push(`abrir ciclo ${c.conversationId}: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (!isBusinessTime(now, ctx.calendar)) {
    result.errors.push("fora do horário comercial");
    return result;
  }
  const gate = await canSendFollowupNow(companyId, now);
  if (!gate.ok) {
    result.errors.push(`gate: ${gate.reason ?? "bloqueado"}`);
    return result;
  }

  const due = await dueCycles(
    companyId,
    now,
    Math.min(MAX_DUE_PER_TICK, gate.remainingToday ?? MAX_DUE_PER_TICK),
  );
  result.scanned = due.length;

  for (const cycle of due) {
    try {
      if (await reanchorIfWeSpokeAgain(cycle, ctx)) {
        result.skipped.push({
          conversationId: cycle.conversation_id,
          rule: cycle.reason,
          reason: "equipe falou de novo: próxima tentativa reagendada",
        });
        continue;
      }

      const attempt = cycle.attempts + 1;
      const candidate = {
        conversationId: cycle.conversation_id,
        leadId: cycle.lead_id,
        rule: cycle.reason,
        referenceKey: cycle.reference_key,
        referenceAt: cycle.reference_at,
        signal: String(cycle.metadata?.signal ?? cycle.reason),
      };
      const built = await buildMessage(candidate, s, attempt, v2.humanize);
      const r = await dispatchFollowup({
        companyId,
        conversationId: cycle.conversation_id,
        leadId: cycle.lead_id,
        rule: cycle.reason,
        attempt,
        text: built.text,
        outsideWindow: await isOutsideWhatsappWindow(cycle.conversation_id),
        signal: candidate.signal,
        referenceAt: cycle.reference_at,
        trigger: { kind: "auto" },
        cycleId: cycle.id,
      });
      const applied = await applyDispatchOutcome(cycle, r, ctx);
      if (applied.state === "closed") result.closed = (result.closed ?? 0) + 1;

      if (r.status === "sent") result.sent++;
      else if (r.status === "simulated") result.simulated = (result.simulated ?? 0) + 1;
      else if (r.status === "failed")
        result.errors.push(
          `${cycle.reason}${r.via === "template" ? " (template)" : ""}: ${r.error}`,
        );
      else
        result.skipped.push({
          conversationId: cycle.conversation_id,
          rule: cycle.reason,
          reason: r.reason ?? "indisponível",
        });
    } catch (e) {
      result.errors.push(`ciclo ${cycle.id}: ${e instanceof Error ? e.message : e}`);
    }
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
