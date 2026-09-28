// ============================================================================
// followup/gates.ts
// Responsabilidade: gate global de envio. Aplica warmup, limite diário e
// pausa automática por baixa taxa de resposta.
//
// Falha FECHADA: qualquer erro (ou configuração ilegível) bloqueia o envio —
// um gate que libera quando não consegue decidir não protege a conta.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { startOfZonedDay } from "./calendar";
import { getWhatsappIntegrationStatus } from "./integration";
import { getFollowupSettings, getFollowupV2Settings } from "./settings";
import type { SendGateResult } from "./types";

/** Envios que chegaram ao cliente (o resto não conta para limite nem taxa). */
export const DELIVERED_STATUSES = ["sent", "responded", "recovered"];

/**
 * Capacidade diária durante o warmup progressivo.
 * Exportada para uso interno em analytics — não faz parte do barrel público.
 */
export function warmupCapacity(
  startedAt: string | null,
  dailyLimit: number,
  now = Date.now(),
): number {
  if (!startedAt) return Math.ceil(dailyLimit * 0.1);
  const days = Math.floor((now - new Date(startedAt).getTime()) / (24 * 3600 * 1000));
  if (days >= 7) return dailyLimit;
  if (days >= 3) return Math.ceil(dailyLimit * 0.5);
  if (days >= 1) return Math.ceil(dailyLimit * 0.25);
  return Math.ceil(dailyLimit * 0.1);
}

export async function canSendFollowupNow(
  companyId: string,
  now = new Date(),
): Promise<SendGateResult> {
  try {
    const [v1, v2] = await Promise.all([
      getFollowupSettings(companyId),
      getFollowupV2Settings(companyId),
    ]);
    if (!v1 || !v2) return { ok: false, reason: "configuração de follow-up indisponível" };

    // 1) integração ativa
    const status = await getWhatsappIntegrationStatus(companyId);
    if (!status.connected) return { ok: false, reason: "sem integração WhatsApp ativa" };

    // 2) warmup: começa a contar no primeiro uso. Sem isso a data nunca era
    //    gravada e a capacidade ficava presa em 10% para sempre.
    let warmupStartedAt = v2.warmupStartedAt;
    if (v2.warmupEnabled && !warmupStartedAt) {
      warmupStartedAt = now.toISOString();
      const { error } = await supabaseAdmin
        .from("company_settings")
        .update({ ai_followup_warmup_started_at: warmupStartedAt } as never)
        .eq("company_id", companyId)
        .is("ai_followup_warmup_started_at", null);
      if (error) return { ok: false, reason: "não foi possível iniciar o warmup" };
    }

    // 3) limite diário — "hoje" no fuso da empresa
    const startOfDay = startOfZonedDay(now, v1.timeZone);
    const { count: sentToday, error: countError } = await supabaseAdmin
      .from("follow_ups")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("status", DELIVERED_STATUSES)
      .gte("sent_at", startOfDay.toISOString());
    if (countError) return { ok: false, reason: "não foi possível contar os envios de hoje" };
    const cap = v2.warmupEnabled
      ? warmupCapacity(warmupStartedAt, v2.dailyLimit, now.getTime())
      : v2.dailyLimit;
    if ((sentToday ?? 0) >= cap)
      return { ok: false, reason: `limite diário atingido (${cap})`, remainingToday: 0 };

    // 4) pausa por taxa de resposta baixa nos últimos 7 dias (só entregues)
    const sevenDays = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
    const { data: recent, error: recentError } = await supabaseAdmin
      .from("follow_ups")
      .select("status, responded_at")
      .eq("company_id", companyId)
      .in("status", DELIVERED_STATUSES)
      .gte("sent_at", sevenDays);
    if (recentError) return { ok: false, reason: "não foi possível calcular a taxa de resposta" };
    const totalRecent = recent?.length ?? 0;
    if (totalRecent >= 20) {
      const responded = (recent ?? []).filter((f) => f.responded_at).length;
      const rate = responded / totalRecent;
      if (rate < v2.minResponseRate)
        return {
          ok: false,
          reason: `taxa de resposta baixa (${(rate * 100).toFixed(1)}% < ${(v2.minResponseRate * 100).toFixed(1)}%) — pausado automaticamente`,
        };
    }

    return { ok: true, remainingToday: cap - (sentToday ?? 0) };
  } catch (e) {
    return { ok: false, reason: `gate indisponível: ${e instanceof Error ? e.message : "erro"}` };
  }
}
