// ============================================================================
// AI Readiness & Health — server-only
// Calcula status de prontidão e métricas para o painel "Saúde da IA".
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AIStatus =
  | "desativada"
  | "parcialmente_configurada"
  | "pronta"
  | "piloto"
  | "ativa";

export interface AIChecklistItem {
  key: "ai_profile" | "whatsapp" | "business_hours" | "initial_message";
  label: string;
  ok: boolean;
  hint?: string;
}

export interface AIReadiness {
  status: AIStatus;
  pilotMode: boolean;
  autoReplyEnabled: boolean;
  canActivate: boolean;
  checklist: AIChecklistItem[];
  missing: string[];
}

export interface AIHealth {
  lastRunAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  autoRepliesToday: number;
  handoffsToday: number;
  hotLeadsDetected: number;
  sendFailuresToday: number;
  qualificationEventsToday: number;
  pilotEnabledAt: string | null;
  lastTestAt: string | null;
  lastTestResult: Record<string, unknown> | null;
}

const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

function profileLooksConfigured(p: {
  description?: string | null;
  products?: string | null;
  region?: string | null;
} | null): boolean {
  if (!p) return false;
  const filled = [p.description, p.products, p.region].filter(
    (x) => typeof x === "string" && x.trim().length > 4,
  ).length;
  return filled >= 2;
}

export async function getReadiness(companyId: string): Promise<AIReadiness> {
  const [{ data: settings }, { data: profile }, { data: integ }] = await Promise.all([
    supabaseAdmin
      .from("company_settings")
      .select(
        "ai_auto_reply_enabled, ai_pilot_mode, ai_initial_message, business_hours_start, business_hours_end",
      )
      .eq("company_id", companyId)
      .maybeSingle(),
    supabaseAdmin
      .from("ai_profiles")
      .select("description, products, region")
      .eq("company_id", companyId)
      .maybeSingle(),
    supabaseAdmin
      .from("integrations")
      .select("id, active")
      .eq("company_id", companyId)
      .eq("channel", "whatsapp")
      .eq("active", true)
      .limit(1)
      .maybeSingle(),
  ]);

  const profileOk = profileLooksConfigured(profile);
  const whatsappOk = !!integ?.id;
  const hoursOk =
    !!settings?.business_hours_start &&
    !!settings?.business_hours_end &&
    TIME_RE.test(settings.business_hours_start) &&
    TIME_RE.test(settings.business_hours_end) &&
    settings.business_hours_start !== settings.business_hours_end;
  const initialOk =
    typeof settings?.ai_initial_message === "string" &&
    settings.ai_initial_message.trim().length > 10;

  const checklist: AIChecklistItem[] = [
    { key: "ai_profile", label: "Perfil da IA preenchido (descrição, produtos, região)", ok: profileOk },
    { key: "whatsapp", label: "WhatsApp Cloud API conectado", ok: whatsappOk },
    { key: "business_hours", label: "Horário comercial configurado", ok: hoursOk },
    { key: "initial_message", label: "Mensagem inicial configurada (≥ 10 caracteres)", ok: initialOk },
  ];

  const missing = checklist.filter((c) => !c.ok).map((c) => c.label);
  const canActivate = missing.length === 0;
  const autoReplyEnabled = !!settings?.ai_auto_reply_enabled;
  const pilotMode = !!settings?.ai_pilot_mode;

  let status: AIStatus;
  if (!canActivate && !autoReplyEnabled) {
    status = missing.length === 4 ? "desativada" : "parcialmente_configurada";
  } else if (canActivate && !autoReplyEnabled) {
    status = "pronta";
  } else if (autoReplyEnabled && pilotMode) {
    status = "piloto";
  } else {
    status = "ativa";
  }

  return { status, pilotMode, autoReplyEnabled, canActivate, checklist, missing };
}

const startOfDayISO = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

export async function getHealth(companyId: string): Promise<AIHealth> {
  const since = startOfDayISO();
  const [{ data: settings }, { data: events }, { data: lastErr }] = await Promise.all([
    supabaseAdmin
      .from("company_settings")
      .select("ai_pilot_enabled_at, ai_last_test_at, ai_last_test_result")
      .eq("company_id", companyId)
      .maybeSingle(),
    supabaseAdmin
      .from("ai_flow_events")
      .select("event_type, created_at")
      .eq("company_id", companyId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("ai_flow_events")
      .select("event_type, created_at, payload")
      .eq("company_id", companyId)
      .in("event_type", ["agent_error", "send_failed", "gateway_timeout"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const list = events ?? [];
  const lastRunAt = list[0]?.created_at ?? null;
  const count = (t: string) => list.filter((e) => e.event_type === t).length;
  const handoffsToday = list.filter((e) => e.event_type === "handoff_human" || e.event_type === "safety_handoff").length;
  const qualificationToday = list.filter((e) =>
    e.event_type.startsWith("detected_") || e.event_type === "qualification_detected",
  ).length;

  return {
    lastRunAt,
    lastErrorAt: lastErr?.created_at ?? null,
    lastError: lastErr
      ? `${lastErr.event_type}: ${JSON.stringify(lastErr.payload ?? {}).slice(0, 160)}`
      : null,
    autoRepliesToday: count("auto_reply_sent"),
    handoffsToday,
    hotLeadsDetected: list.filter(
      (e) => e.event_type === "lead_bumped_to_hot" || e.event_type === "lead_temperature_changed",
    ).length,
    sendFailuresToday: list.filter(
      (e) => e.event_type === "send_failed" || e.event_type === "agent_error",
    ).length,
    qualificationEventsToday: qualificationToday,
    pilotEnabledAt: (settings as { ai_pilot_enabled_at?: string | null })?.ai_pilot_enabled_at ?? null,
    lastTestAt: (settings as { ai_last_test_at?: string | null })?.ai_last_test_at ?? null,
    lastTestResult:
      (settings as { ai_last_test_result?: Record<string, unknown> | null })?.ai_last_test_result ?? null,
  };
}
