// ============================================================================
// Configuração e log de follow-ups — endpoint do painel /ia.
// GET: retorna configurações + últimos follow-ups + métricas básicas.
// PUT: atualiza configurações.
// POST { action: "run" }: dispara um tick manual (apenas para a empresa do user).
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getFollowupSettings,
  runFollowupTickForCompany,
  reconcileResponses,
} from "@/lib/ai-followup.server";

async function authedCompanyId(request: Request): Promise<string | null> {
  const h = request.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  const { data } = await supabaseAdmin.auth.getUser(token);
  if (!data?.user) return null;
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("company_id")
    .eq("id", data.user.id)
    .maybeSingle();
  return prof?.company_id ?? null;
}

async function getRecentLog(companyId: string) {
  const { data } = await supabaseAdmin
    .from("follow_ups")
    .select("id, rule_type, attempt_number, message_text, status, sent_at, responded_at, response_outcome, conversation_id, lead_id")
    .eq("company_id", companyId)
    .order("sent_at", { ascending: false })
    .limit(50);
  return data ?? [];
}

async function getMetrics(companyId: string) {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("follow_ups")
    .select("status, rule_type, sent_at, responded_at")
    .eq("company_id", companyId)
    .gte("sent_at", since);
  const list = data ?? [];
  const sent = list.length;
  const responded = list.filter(
    (f) => f.status === "responded" || f.status === "recovered",
  ).length;
  const recovered = list.filter((f) => f.status === "recovered").length;
  const failed = list.filter((f) => f.status === "failed").length;
  const responseRate = sent ? Math.round((responded / sent) * 1000) / 10 : 0;
  // melhor horário (hora com mais respostas)
  const hourCount = new Map<number, number>();
  for (const f of list) {
    if (!f.responded_at) continue;
    const h = new Date(f.sent_at).getHours();
    hourCount.set(h, (hourCount.get(h) ?? 0) + 1);
  }
  let bestHour: number | null = null;
  let bestHourCount = 0;
  for (const [h, c] of hourCount.entries()) {
    if (c > bestHourCount) {
      bestHour = h;
      bestHourCount = c;
    }
  }
  // melhor mensagem (rule_type com maior taxa de resposta)
  const ruleStats = new Map<string, { sent: number; responded: number }>();
  for (const f of list) {
    const s = ruleStats.get(f.rule_type) ?? { sent: 0, responded: 0 };
    s.sent++;
    if (f.responded_at) s.responded++;
    ruleStats.set(f.rule_type, s);
  }
  let bestRule: string | null = null;
  let bestRuleRate = 0;
  for (const [k, v] of ruleStats.entries()) {
    const r = v.sent ? v.responded / v.sent : 0;
    if (r > bestRuleRate) {
      bestRule = k;
      bestRuleRate = r;
    }
  }
  return {
    sent,
    responded,
    recovered,
    failed,
    responseRate,
    bestHour,
    bestRule,
    bestRuleRate: Math.round(bestRuleRate * 1000) / 10,
  };
}

export const Route = createFileRoute("/api/ai/followup-config")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const companyId = await authedCompanyId(request);
        if (!companyId)
          return Response.json({ ok: false, error: "não autenticado" }, { status: 401 });
        await reconcileResponses(companyId); // atualiza respostas pendentes
        const [settings, log, metrics] = await Promise.all([
          getFollowupSettings(companyId),
          getRecentLog(companyId),
          getMetrics(companyId),
        ]);
        return Response.json({ ok: true, settings, log, metrics });
      },
      PUT: async ({ request }: { request: Request }) => {
        const companyId = await authedCompanyId(request);
        if (!companyId)
          return Response.json({ ok: false, error: "não autenticado" }, { status: 401 });
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const allowed: Record<string, unknown> = {};
        const map: Record<string, string> = {
          enabled: "ai_followup_enabled",
          maxPerLead: "ai_followup_max_per_lead",
          minHoursBetween: "ai_followup_min_hours_between",
          quoteDelayHours: "ai_followup_quote_delay_hours",
          silenceDelayHours: "ai_followup_silence_delay_hours",
          visitDelayHours: "ai_followup_visit_delay_hours",
          hotDelayHours: "ai_followup_hot_delay_hours",
          businessHoursOnly: "ai_followup_business_hours_only",
          tone: "ai_followup_tone",
          templates: "ai_followup_templates",
        };
        for (const [k, col] of Object.entries(map)) {
          if (k in body) allowed[col] = body[k];
        }
        if (Object.keys(allowed).length === 0)
          return Response.json({ ok: false, error: "nada para atualizar" }, { status: 400 });
        const { error } = await supabaseAdmin
          .from("company_settings")
          .update(allowed)
          .eq("company_id", companyId);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        const settings = await getFollowupSettings(companyId);
        return Response.json({ ok: true, settings });
      },
      POST: async ({ request }: { request: Request }) => {
        const companyId = await authedCompanyId(request);
        if (!companyId)
          return Response.json({ ok: false, error: "não autenticado" }, { status: 401 });
        const body = (await request.json().catch(() => ({}))) as { action?: string };
        if (body.action !== "run")
          return Response.json({ ok: false, error: "ação inválida" }, { status: 400 });
        const result = await runFollowupTickForCompany(companyId);
        return Response.json({ ok: true, result });
      },
    },
  },
});
