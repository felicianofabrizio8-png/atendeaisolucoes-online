// ============================================================================
// followup/settings.ts
// Responsabilidade: leitura de configurações do módulo em company_settings.
// Combina defaults (v1) e valores opcionais (v2) sem alterar o schema.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DEFAULT_TEMPLATES } from "./defaults";
import type {
  FollowupRule,
  FollowupSettings,
  FollowupV2Settings,
} from "./types";

export async function getFollowupSettings(
  companyId: string,
): Promise<FollowupSettings | null> {
  const { data } = await supabaseAdmin
    .from("company_settings")
    .select(
      "ai_followup_enabled, ai_followup_max_per_lead, ai_followup_min_hours_between, ai_followup_quote_delay_hours, ai_followup_silence_delay_hours, ai_followup_visit_delay_hours, ai_followup_hot_delay_hours, ai_followup_business_hours_only, ai_followup_tone, ai_followup_templates, ai_initial_message, ai_agent_name, business_hours_start, business_hours_end",
    )
    .eq("company_id", companyId)
    .maybeSingle();
  if (!data) return null;
  const tpl = (data.ai_followup_templates as Partial<Record<FollowupRule, string>>) ?? {};
  return {
    enabled: !!data.ai_followup_enabled,
    maxPerLead: data.ai_followup_max_per_lead ?? 3,
    minHoursBetween: data.ai_followup_min_hours_between ?? 24,
    quoteDelayHours: data.ai_followup_quote_delay_hours ?? 24,
    silenceDelayHours: data.ai_followup_silence_delay_hours ?? 48,
    visitDelayHours: data.ai_followup_visit_delay_hours ?? 24,
    hotDelayHours: data.ai_followup_hot_delay_hours ?? 4,
    businessHoursOnly: data.ai_followup_business_hours_only ?? true,
    businessHoursStart: data.business_hours_start ?? "09:00:00",
    businessHoursEnd: data.business_hours_end ?? "18:00:00",
    tone: data.ai_followup_tone ?? "amigavel",
    templates: { ...DEFAULT_TEMPLATES, ...tpl },
    initialMessage: data.ai_initial_message,
    agentName: data.ai_agent_name ?? "Fabrizio",
  };
}

export async function getFollowupV2Settings(
  companyId: string,
): Promise<FollowupV2Settings | null> {
  try {
    const { data } = await supabaseAdmin
      .from("company_settings")
      .select(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "ai_followup_humanize, ai_followup_delay_jitter_minutes, ai_followup_daily_limit, ai_followup_min_response_rate, ai_followup_warmup_enabled, ai_followup_warmup_started_at, ai_followup_reactivation_enabled, ai_followup_reactivation_days, ai_followup_reactivation_daily_max, ai_followup_reactivation_hours_start, ai_followup_reactivation_hours_end, ai_followup_reactivation_template" as any,
      )
      .eq("company_id", companyId)
      .maybeSingle();
    if (!data) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any;
    return {
      humanize: d.ai_followup_humanize ?? true,
      delayJitterMinutes: d.ai_followup_delay_jitter_minutes ?? 35,
      dailyLimit: d.ai_followup_daily_limit ?? 50,
      minResponseRate: Number(d.ai_followup_min_response_rate ?? 0.05),
      warmupEnabled: d.ai_followup_warmup_enabled ?? true,
      warmupStartedAt: d.ai_followup_warmup_started_at ?? null,
      reactivationEnabled: d.ai_followup_reactivation_enabled ?? false,
      reactivationDays: d.ai_followup_reactivation_days ?? 30,
      reactivationDailyMax: d.ai_followup_reactivation_daily_max ?? 10,
      reactivationHoursStart: d.ai_followup_reactivation_hours_start ?? "09:00:00",
      reactivationHoursEnd: d.ai_followup_reactivation_hours_end ?? "18:00:00",
      reactivationTemplate:
        d.ai_followup_reactivation_template ??
        "Oi {{nome}}, faz um tempinho que não nos falamos. Posso te ajudar com algo hoje?",
    };
  } catch {
    return null;
  }
}
