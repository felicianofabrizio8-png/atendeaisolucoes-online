// ============================================================================
// followup/scoring.ts
// Responsabilidade: calcular o score de um lead e resumir a temperatura
// (hot/warm/cold) para o painel — persistindo cache em `leads`.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { LeadScoreResult, LeadTemperature } from "./types";

export async function computeLeadScoreFromDb(leadId: string): Promise<LeadScoreResult> {
  try {
    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("id, company_id, created_at, updated_at")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead) return { score: 0, temperature: "cold" };

    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const { data: convs } = await supabaseAdmin
      .from("conversations")
      .select("id, last_message_at")
      .eq("lead_id", leadId)
      .gte("updated_at", since);
    const convIds = (convs ?? []).map((c) => c.id);

    let msgCount = 0;
    let lastClientAt: string | null = null;
    if (convIds.length) {
      const { data: msgs } = await supabaseAdmin
        .from("messages")
        .select("role, at")
        .in("conversation_id", convIds)
        .gte("at", since);
      for (const m of msgs ?? []) {
        if (m.role === "lead") {
          msgCount++;
          if (!lastClientAt || m.at > lastClientAt) lastClientAt = m.at;
        }
      }
    }

    const { data: quotes } = await supabaseAdmin
      .from("quotes")
      .select("id")
      .eq("lead_id", leadId)
      .limit(5);

    const { data: respondedFu } = await supabaseAdmin
      .from("follow_ups")
      .select("id")
      .eq("lead_id", leadId)
      .in("status", ["responded", "recovered"])
      .limit(5);

    let score = 0;
    score += Math.min(msgCount, 10) * 4;
    if ((quotes?.length ?? 0) > 0) score += 25;
    if ((respondedFu?.length ?? 0) > 0) score += 15;
    if (lastClientAt) {
      const ageHrs = (Date.now() - new Date(lastClientAt).getTime()) / 3600_000;
      if (ageHrs < 24) score += 20;
      else if (ageHrs < 72) score += 10;
      else if (ageHrs < 168) score += 5;
    }
    score = Math.max(0, Math.min(100, score));
    const temperature: LeadTemperature =
      score >= 60 ? "hot" : score >= 30 ? "warm" : "cold";

    await supabaseAdmin
      .from("leads")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({
        lead_score: score,
        lead_temperature_cached: temperature,
        last_score_at: new Date().toISOString(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .eq("id", leadId);

    return { score, temperature };
  } catch {
    return { score: 0, temperature: "cold" };
  }
}

export async function getLeadTemperatureSummary(
  companyId: string,
): Promise<{ hot: number; warm: number; cold: number }> {
  try {
    const { data: leads } = await supabaseAdmin
      .from("leads")
      .select("id, status, lead_temperature_cached")
      .eq("company_id", companyId)
      .not("status", "in", "(fechado,perdido)");
    const leadRows = (leads ?? []) as Array<{
      id: string;
      status: string;
      lead_temperature_cached: string | null;
    }>;
    if (!leadRows.length) return { hot: 0, warm: 0, cold: 0 };

    const leadIds = leadRows.map((l) => l.id);
    const now = Date.now();
    const since30 = new Date(now - 30 * 24 * 3600 * 1000).toISOString();
    const nowIso = new Date(now).toISOString();

    const [convsRes, quotesRes, visitsRes] = await Promise.all([
      supabaseAdmin
        .from("conversations")
        .select("id, lead_id")
        .eq("company_id", companyId)
        .in("lead_id", leadIds),
      supabaseAdmin
        .from("quotes")
        .select("lead_id")
        .eq("company_id", companyId)
        .in("lead_id", leadIds),
      supabaseAdmin
        .from("visits")
        .select("lead_id, scheduled_at, status")
        .eq("company_id", companyId)
        .in("lead_id", leadIds),
    ]);

    const convs = (convsRes.data ?? []) as Array<{ id: string; lead_id: string }>;
    const convToLead = new Map<string, string>();
    for (const c of convs) convToLead.set(c.id, c.lead_id);

    const lastClientByLead = new Map<string, number>();
    if (convs.length) {
      const { data: msgs } = await supabaseAdmin
        .from("messages")
        .select("conversation_id, at, role")
        .eq("company_id", companyId)
        .eq("role", "lead")
        .in(
          "conversation_id",
          convs.map((c) => c.id),
        )
        .gte("at", since30);
      for (const m of msgs ?? []) {
        const leadId = convToLead.get(m.conversation_id as string);
        if (!leadId) continue;
        const t = new Date(m.at as string).getTime();
        const cur = lastClientByLead.get(leadId) ?? 0;
        if (t > cur) lastClientByLead.set(leadId, t);
      }
    }

    const hasQuote = new Set<string>();
    for (const q of quotesRes.data ?? [])
      if (q.lead_id) hasQuote.add(q.lead_id as string);

    const hasUpcomingVisit = new Set<string>();
    for (const v of visitsRes.data ?? []) {
      if (!v.lead_id) continue;
      const when = v.scheduled_at
        ? new Date(v.scheduled_at as string).getTime()
        : 0;
      if (when >= now && v.status !== "cancelada")
        hasUpcomingVisit.add(v.lead_id as string);
    }

    let hot = 0;
    let warm = 0;
    let cold = 0;
    const updates: Array<{ id: string; t: LeadTemperature }> = [];

    for (const l of leadRows) {
      const lastClient = lastClientByLead.get(l.id) ?? 0;
      const ageDays = lastClient ? (now - lastClient) / 86_400_000 : Infinity;
      let t: LeadTemperature;
      if (
        hasQuote.has(l.id) ||
        hasUpcomingVisit.has(l.id) ||
        (lastClient && ageDays <= 7)
      ) {
        t = "hot";
      } else if (lastClient && ageDays <= 30) {
        t = "warm";
      } else {
        t = "cold";
      }
      if (t === "hot") hot++;
      else if (t === "warm") warm++;
      else cold++;
      if (l.lead_temperature_cached !== t) updates.push({ id: l.id, t });
    }

    if (updates.length) {
      await Promise.all(
        updates.map((u) =>
          supabaseAdmin
            .from("leads")
            .update({
              lead_temperature_cached: u.t,
              last_score_at: nowIso,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any)
            .eq("id", u.id),
        ),
      ).catch(() => undefined);
    }

    return { hot, warm, cold };
  } catch {
    return { hot: 0, warm: 0, cold: 0 };
  }
}
