// ============================================================================
// followup/gates.ts
// Responsabilidade: gate global de envio (v2). Aplica warmup, limite diário
// e pausa automática por baixa taxa de resposta. Falha-segura: se algo
// quebrar retorna { ok: true } para não travar o tick principal.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getWhatsappIntegrationStatus } from "./integration";
import { getFollowupV2Settings } from "./settings";
import type { SendGateResult } from "./types";

/**
 * Capacidade diária durante o warmup progressivo.
 * Exportada para uso interno em analytics — não faz parte do barrel público.
 */
export function warmupCapacity(startedAt: string | null, dailyLimit: number): number {
  if (!startedAt) return Math.ceil(dailyLimit * 0.1);
  const days = Math.floor((Date.now() - new Date(startedAt).getTime()) / (24 * 3600 * 1000));
  if (days >= 7) return dailyLimit;
  if (days >= 3) return Math.ceil(dailyLimit * 0.5);
  if (days >= 1) return Math.ceil(dailyLimit * 0.25);
  return Math.ceil(dailyLimit * 0.1);
}

export async function canSendFollowupNow(companyId: string): Promise<SendGateResult> {
  try {
    const v2 = await getFollowupV2Settings(companyId);
    if (!v2) return { ok: true }; // sem v2, deixa o tick principal decidir

    // 1) integração ativa
    const status = await getWhatsappIntegrationStatus(companyId);
    if (!status.connected) return { ok: false, reason: "sem integração WhatsApp ativa" };

    // 2) limite diário (com warmup)
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { count: sentToday } = await supabaseAdmin
      .from("follow_ups")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "sent")
      .gte("sent_at", startOfDay.toISOString());
    const cap = v2.warmupEnabled
      ? warmupCapacity(v2.warmupStartedAt, v2.dailyLimit)
      : v2.dailyLimit;
    if ((sentToday ?? 0) >= cap)
      return { ok: false, reason: `limite diário atingido (${cap})`, remainingToday: 0 };

    // 3) pausa por taxa de resposta baixa nos últimos 7 dias
    const sevenDays = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("follow_ups")
      .select("status, responded_at")
      .eq("company_id", companyId)
      .gte("sent_at", sevenDays);
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
    return { ok: true, reason: e instanceof Error ? e.message : "gate v2 falhou" };
  }
}
