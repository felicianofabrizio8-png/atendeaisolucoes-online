// ============================================================================
// followup/analytics.ts
// Responsabilidade: agregar métricas dos últimos 30 dias exibidas no painel
// /ia (por dia, por regra, melhor hora/template, valor recuperado, limites).
// Somente leitura, tolerante a falha.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { warmupCapacity } from "./gates";
import { getFollowupV2Settings } from "./settings";
import type { AdvancedAnalytics } from "./types";

export async function getAdvancedAnalytics(
  companyId: string,
): Promise<AdvancedAnalytics> {
  const out: AdvancedAnalytics = {
    byDay: [],
    byRule: [],
    recoveredValue: 0,
    bestHour: null,
    bestTemplate: null,
    bestTemplateRate: 0,
    todaySent: 0,
    todayLimit: 0,
  };
  try {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const { data: fups } = await supabaseAdmin
      .from("follow_ups")
      .select("rule_type, status, sent_at, responded_at, lead_id")
      .eq("company_id", companyId)
      .gte("sent_at", since);
    const list = fups ?? [];

    // por dia
    const dayMap = new Map<string, { sent: number; responded: number; recovered: number }>();
    for (const f of list) {
      const day = new Date(f.sent_at).toISOString().slice(0, 10);
      const cur = dayMap.get(day) ?? { sent: 0, responded: 0, recovered: 0 };
      cur.sent++;
      if (f.responded_at) cur.responded++;
      if (f.status === "recovered") cur.recovered++;
      dayMap.set(day, cur);
    }
    out.byDay = Array.from(dayMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, v]) => ({ day, ...v }));

    // por regra
    const ruleMap = new Map<string, { sent: number; responded: number }>();
    for (const f of list) {
      const cur = ruleMap.get(f.rule_type) ?? { sent: 0, responded: 0 };
      cur.sent++;
      if (f.responded_at) cur.responded++;
      ruleMap.set(f.rule_type, cur);
    }
    out.byRule = Array.from(ruleMap.entries()).map(([rule, v]) => ({
      rule,
      sent: v.sent,
      responded: v.responded,
      rate: v.sent ? Math.round((v.responded / v.sent) * 1000) / 10 : 0,
    }));

    let best: { rule: string; rate: number } | null = null;
    for (const r of out.byRule) {
      if (r.sent >= 3 && (!best || r.rate > best.rate)) best = { rule: r.rule, rate: r.rate };
    }
    if (best) {
      out.bestTemplate = best.rule;
      out.bestTemplateRate = best.rate;
    }

    // melhor hora
    const hourMap = new Map<number, number>();
    for (const f of list) {
      if (!f.responded_at) continue;
      const h = new Date(f.sent_at).getHours();
      hourMap.set(h, (hourMap.get(h) ?? 0) + 1);
    }
    let bestH = -1,
      bestC = 0;
    for (const [h, c] of hourMap.entries()) {
      if (c > bestC) {
        bestH = h;
        bestC = c;
      }
    }
    if (bestH >= 0) out.bestHour = bestH;

    // valor recuperado
    const recoveredLeadIds = list
      .filter((f) => f.status === "recovered" && f.lead_id)
      .map((f) => f.lead_id as string);
    if (recoveredLeadIds.length) {
      const { data: leads } = await supabaseAdmin
        .from("leads")
        .select("id, closed_value, estimated_value")
        .in("id", recoveredLeadIds);
      for (const l of leads ?? []) {
        out.recoveredValue += Number(l.closed_value ?? l.estimated_value ?? 0);
      }
    }

    // limite/sent hoje
    const v2 = await getFollowupV2Settings(companyId);
    if (v2) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { count } = await supabaseAdmin
        .from("follow_ups")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("status", "sent")
        .gte("sent_at", startOfDay.toISOString());
      out.todaySent = count ?? 0;
      out.todayLimit = v2.warmupEnabled
        ? warmupCapacity(v2.warmupStartedAt, v2.dailyLimit)
        : v2.dailyLimit;
    }
  } catch {
    // fallback silencioso
  }
  return out;
}
