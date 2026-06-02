// Server functions for Meta Ads pilot readiness.
// - listMetaAdAccounts: busca contas de anúncio da Meta via Graph API
// - selectMetaAdAccount: salva ad_account_id em integrations.account_metadata
// - getMetaPublishReadiness: checklist agregado para a empresa
// - enableMetaBeta: liga/desliga a flag meta_campaigns_beta (admin)
//
// Nada de inbox/WhatsApp/webhooks/IA/storage é alterado aqui.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GRAPH = "https://graph.facebook.com/v21.0";

const REQUIRED_SCOPES = [
  "ads_management",
  "ads_read",
  "pages_manage_ads",
  "pages_read_engagement",
] as const;

type Integ = {
  id: string;
  channel: string;
  access_token: string | null;
  account_metadata: Record<string, unknown> | null;
  external_account_id: string | null;
  display_name: string | null;
  active: boolean;
};

async function loadActiveMetaIntegration(
  supabase: { from: (t: string) => { select: (s: string) => { eq: (k: string, v: unknown) => { eq: (k: string, v: unknown) => { in: (k: string, v: string[]) => Promise<{ data: unknown }> } } } } },
  companyId: string,
): Promise<Integ | null> {
  const { data } = await supabase
    .from("integrations")
    .select(
      "id, channel, access_token, account_metadata, external_account_id, display_name, active",
    )
    .eq("company_id", companyId)
    .eq("active", true)
    .in("channel", ["instagram", "facebook"]);
  const list = (data ?? []) as unknown as Integ[];
  if (list.length === 0) return null;
  // Prefer integration that already has ad_account_id; else first.
  return list.find((i) => Boolean((i.account_metadata ?? {})["ad_account_id"])) ?? list[0];
}

async function getCompanyId(
  supabase: { from: (t: string) => { select: (s: string) => { eq: (k: string, v: unknown) => { maybeSingle: () => Promise<{ data: { company_id: string } | null }> } } } },
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  return data?.company_id ?? null;
}

async function hasAdminRole(
  supabase: unknown,
  userId: string,
): Promise<boolean> {
  const sb = supabase as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: boolean | null }>;
  };
  const { data } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
  return Boolean(data);
}

// ----------------- LIST AD ACCOUNTS -----------------
export const listMetaAdAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const companyId = await getCompanyId(supabase as never, userId);
    if (!companyId) return { ok: false as const, error: "no_company" };

    const integ = await loadActiveMetaIntegration(supabase as never, companyId);
    if (!integ?.access_token) {
      return { ok: false as const, error: "no_integration", message: "Conecte uma conta Meta antes." };
    }

    const token = integ.access_token;

    // 1) Lista ad accounts
    const accRes = await fetch(
      `${GRAPH}/me/adaccounts?fields=id,account_id,name,account_status,currency,timezone_name,business{id,name}&access_token=${encodeURIComponent(token)}`,
    );
    const accText = await accRes.text();
    if (!accRes.ok) {
      return { ok: false as const, error: "graph_error", message: accText.slice(0, 500) };
    }
    const accBody = JSON.parse(accText) as {
      data?: Array<{
        id: string;
        account_id?: string;
        name?: string;
        account_status?: number;
        currency?: string;
        timezone_name?: string;
        business?: { id?: string; name?: string };
      }>;
    };

    // 2) Lista scopes do token (debug_token requer app token; usar o próprio token funciona em modo dev)
    let scopes: string[] = [];
    try {
      const dbgRes = await fetch(
        `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`,
      );
      if (dbgRes.ok) {
        const dbg = (await dbgRes.json()) as { data?: { scopes?: string[] } };
        scopes = dbg.data?.scopes ?? [];
      }
    } catch {
      /* noop */
    }

    const accounts = (accBody.data ?? []).map((a) => ({
      id: a.id,
      account_id: a.account_id ?? a.id.replace(/^act_/, ""),
      name: a.name ?? a.id,
      status: a.account_status ?? 0,
      currency: a.currency ?? "",
      timezone: a.timezone_name ?? "",
      business: a.business?.name ?? null,
    }));

    const meta = (integ.account_metadata ?? {}) as Record<string, unknown>;
    const selectedAdAccountId = String(meta["ad_account_id"] ?? "");

    const missingScopes = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));

    return {
      ok: true as const,
      integrationId: integ.id,
      integrationName: integ.display_name ?? "",
      accounts,
      selectedAdAccountId,
      scopes,
      missingScopes,
    };
  });

// ----------------- SELECT AD ACCOUNT -----------------
export const selectMetaAdAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        integrationId: z.string().uuid(),
        adAccountId: z.string().min(1).max(64).regex(/^(act_)?[0-9]+$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const companyId = await getCompanyId(supabase as never, userId);
    if (!companyId) return { ok: false as const, error: "no_company" };
    const isAdmin = await hasAdminRole(supabase, userId);
    if (!isAdmin) return { ok: false as const, error: "not_admin", message: "Apenas admin pode alterar." };

    // Verifica que a integração pertence à empresa.
    const { data: integ } = await supabase
      .from("integrations")
      .select("id, company_id, account_metadata")
      .eq("id", data.integrationId)
      .maybeSingle();
    const row = integ as { id: string; company_id: string; account_metadata: Record<string, unknown> | null } | null;
    if (!row || row.company_id !== companyId) {
      return { ok: false as const, error: "not_found" };
    }

    const normalized = data.adAccountId.startsWith("act_")
      ? data.adAccountId
      : `act_${data.adAccountId}`;
    const newMeta = { ...(row.account_metadata ?? {}), ad_account_id: normalized };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("integrations")
      .update({ account_metadata: newMeta })
      .eq("id", data.integrationId)
      .eq("company_id", companyId);
    if (error) return { ok: false as const, error: "update_failed", message: error.message };

    return { ok: true as const, adAccountId: normalized };
  });

// ----------------- READINESS CHECKLIST -----------------
export const getMetaPublishReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const companyId = await getCompanyId(supabase as never, userId);
    if (!companyId) return { ok: false as const, error: "no_company" };

    const { data: company } = await supabase
      .from("companies")
      .select("id, meta_campaigns_beta" as never)
      .eq("id", companyId)
      .maybeSingle();
    const betaEnabled = Boolean(
      (company as unknown as { meta_campaigns_beta?: boolean } | null)?.meta_campaigns_beta,
    );

    const isAdmin = await hasAdminRole(supabase, userId);

    const integ = await loadActiveMetaIntegration(supabase as never, companyId);
    const meta = (integ?.account_metadata ?? {}) as Record<string, unknown>;
    const adAccountId = String(meta["ad_account_id"] ?? "");
    const pageId = String(meta["fb_page_id"] ?? integ?.external_account_id ?? "");
    const igId = String(meta["ig_business_account_id"] ?? "");

    // WhatsApp connection
    const { data: waList } = await supabase
      .from("integrations")
      .select("id, active, account_metadata, external_account_id")
      .eq("company_id", companyId)
      .eq("channel", "whatsapp")
      .eq("active", true);
    const waConnected = Array.isArray(waList) && waList.length > 0;

    return {
      ok: true as const,
      betaEnabled,
      isAdmin,
      metaConnected: Boolean(integ?.access_token),
      integrationId: integ?.id ?? null,
      integrationName: integ?.display_name ?? "",
      adAccountId,
      pageId,
      igBusinessAccountId: igId,
      whatsappConnected: waConnected,
    };
  });

// ----------------- ENABLE/DISABLE BETA (admin) -----------------
export const setMetaBetaFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ enabled: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const companyId = await getCompanyId(supabase as never, userId);
    if (!companyId) return { ok: false as const, error: "no_company" };
    const isAdmin = await hasAdminRole(supabase, userId);
    if (!isAdmin) return { ok: false as const, error: "not_admin" };

    // RLS permite update da própria empresa por membros; ok via cliente do usuário.
    const { error } = await supabase
      .from("companies")
      .update({ meta_campaigns_beta: data.enabled } as never)
      .eq("id", companyId);
    if (error) return { ok: false as const, error: "update_failed", message: error.message };
    return { ok: true as const, enabled: data.enabled };
  });
