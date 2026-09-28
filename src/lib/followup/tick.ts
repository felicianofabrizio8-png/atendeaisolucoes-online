// ============================================================================
// followup/tick.ts
// Responsabilidade: loop principal do follow-up automático.
// Aplica os gates (readiness, horário, v2), busca candidatos, valida cada um
// e entrega ao motor único (`dispatch.ts`): texto dentro da janela 24h,
// `chamar_novamente` contextual fora dela, com revalidação antes do envio.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getReadiness } from "@/lib/ai-readiness.server";

import { findCandidates } from "./candidates";
import { isWithinBusinessHours } from "./defaults";
import { dispatchFollowup } from "./dispatch";
import { canSendFollowupNow } from "./gates";
import { buildMessage } from "./message";
import { canSend } from "./safety";
import { getFollowupSettings, getFollowupV2Settings } from "./settings";
import type { TickResult } from "./types";

export async function runFollowupTickForCompany(companyId: string): Promise<TickResult> {
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
  const v2Gate = await canSendFollowupNow(companyId).catch(() => ({
    ok: true as const,
    reason: undefined as string | undefined,
  }));
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

    // Envio, revalidação de última hora e persistência: motor único,
    // compartilhado com o "Follow-up agora".
    const r = await dispatchFollowup({
      companyId,
      conversationId: c.conversationId,
      leadId: c.leadId,
      rule: c.rule,
      attempt,
      text: built.text,
      outsideWindow: check.outsideWindow === true,
      signal: c.signal,
      referenceAt: c.lastClientMessageAt,
      trigger: { kind: "auto" },
    });
    if (r.status === "sent") result.sent++;
    else if (r.status === "simulated") result.simulated = (result.simulated ?? 0) + 1;
    else if (r.status === "failed")
      result.errors.push(`${c.rule}${r.via === "template" ? " (template)" : ""}: ${r.error}`);
    else
      result.skipped.push({
        conversationId: c.conversationId,
        rule: c.rule,
        reason: r.reason ?? "indisponível",
      });
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
