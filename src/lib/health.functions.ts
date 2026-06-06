// Health dashboard server function. Admin-only.
// Agrega status de integrações, último webhook recebido, erros e auditoria recentes.
// Sem efeitos colaterais — apenas leitura.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type SupabaseLike = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }>;
  from: (t: string) => unknown;
};

async function getCompanyAndAdmin(
  supabase: unknown,
  userId: string,
): Promise<{ companyId: string | null; isAdmin: boolean }> {
  const s = supabase as SupabaseLike & {
    from: (t: string) => {
      select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { company_id: string } | null }> } };
    };
  };
  const { data: prof } = await s.from("profiles").select("company_id").eq("id", userId).maybeSingle();
  const companyId = prof?.company_id ?? null;
  const { data: isAdmin } = await s.rpc("has_role", { _user_id: userId, _role: "admin" });
  return { companyId, isAdmin: Boolean(isAdmin) };
}

export interface HealthIntegration {
  id: string;
  channel: string;
  display_name: string;
  active: boolean;
  has_access_token: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  token_expires_at: string | null;
}

export interface HealthErrorRow {
  id: string;
  source: string;
  severity: string;
  message: string;
  created_at: string;
}

export interface HealthAuditRow {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  user_id: string | null;
  created_at: string;
}

export interface HealthSummary {
  ok: boolean;
  isAdmin: boolean;
  generatedAt: string;
  integrations: HealthIntegration[];
  whatsapp: { connected: boolean; lastSyncedAt: string | null; lastError: string | null };
  meta: { connected: boolean; lastSyncedAt: string | null; lastError: string | null };
  ai: { ok: boolean; lastError: string | null; lastErrorAt: string | null };
  lastWebhookAt: string | null;
  lastWhatsappMessageAt: string | null;
  errorCountsByDay: { date: string; count: number }[];
  recentErrors: HealthErrorRow[];
  recentAudit: HealthAuditRow[];
  errorBySource: { source: string; count: number }[];
}

export const getHealthSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HealthSummary> => {
    const { supabase, userId } = context;
    const { companyId, isAdmin } = await getCompanyAndAdmin(supabase, userId);
    if (!companyId || !isAdmin) {
      return {
        ok: false,
        isAdmin: false,
        generatedAt: new Date().toISOString(),
        integrations: [],
        whatsapp: { connected: false, lastSyncedAt: null, lastError: null },
        meta: { connected: false, lastSyncedAt: null, lastError: null },
        ai: { ok: false, lastError: null, lastErrorAt: null },
        lastWebhookAt: null,
        lastWhatsappMessageAt: null,
        errorCountsByDay: [],
        recentErrors: [],
        recentAudit: [],
        errorBySource: [],
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin;

    const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    const [
      { data: integrations },
      { data: errs },
      { data: audit },
      { data: lastWebhook },
      { data: lastWaMsg },
      { data: aiErr },
    ] = await Promise.all([
      sb.from("integrations")
        .select("id, channel, display_name, active, has_access_token, last_synced_at, last_error, token_expires_at")
        .eq("company_id", companyId),
      sb.from("error_log")
        .select("id, source, severity, message, created_at")
        .eq("company_id", companyId)
        .gte("created_at", since7d)
        .order("created_at", { ascending: false })
        .limit(50),
      sb.from("audit_log")
        .select("id, action, entity, entity_id, user_id, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(50),
      sb.from("whatsapp_unmapped_events")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb.from("whatsapp_messages")
        .select("created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb.from("error_log")
        .select("message, created_at")
        .eq("company_id", companyId)
        .eq("source", "ia")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const integ = (integrations ?? []) as HealthIntegration[];
    const whatsappRow = integ.find((i) => i.channel === "whatsapp" && i.active);
    const metaRow = integ.find((i) => (i.channel === "instagram" || i.channel === "facebook") && i.active);

    // erros agregados por dia (últimos 7 dias) e por source
    const byDay = new Map<string, number>();
    const bySource = new Map<string, number>();
    const errsArr = (errs ?? []) as HealthErrorRow[];
    for (const e of errsArr) {
      const day = e.created_at.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
      bySource.set(e.source, (bySource.get(e.source) ?? 0) + 1);
    }
    const days: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
      days.push({ date: d, count: byDay.get(d) ?? 0 });
    }

    const aiLastErrAt = (aiErr as { created_at?: string } | null)?.created_at ?? null;
    const aiOk = !aiLastErrAt || Date.now() - new Date(aiLastErrAt).getTime() > 24 * 3600 * 1000;

    return {
      ok: true,
      isAdmin: true,
      generatedAt: new Date().toISOString(),
      integrations: integ,
      whatsapp: {
        connected: Boolean(whatsappRow?.has_access_token),
        lastSyncedAt: whatsappRow?.last_synced_at ?? null,
        lastError: whatsappRow?.last_error ?? null,
      },
      meta: {
        connected: Boolean(metaRow?.has_access_token),
        lastSyncedAt: metaRow?.last_synced_at ?? null,
        lastError: metaRow?.last_error ?? null,
      },
      ai: {
        ok: aiOk,
        lastError: (aiErr as { message?: string } | null)?.message ?? null,
        lastErrorAt: aiLastErrAt,
      },
      lastWebhookAt: (lastWebhook as { created_at?: string } | null)?.created_at ?? null,
      lastWhatsappMessageAt: (lastWaMsg as { created_at?: string } | null)?.created_at ?? null,
      errorCountsByDay: days,
      recentErrors: errsArr.slice(0, 25),
      recentAudit: ((audit ?? []) as HealthAuditRow[]).slice(0, 25),
      errorBySource: Array.from(bySource.entries()).map(([source, count]) => ({ source, count })),
    };
  });
