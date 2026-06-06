// Server functions for Meta Ads pilot readiness.
// - listMetaAdAccounts: agrega contas via tokens de TODAS integrações Meta ativas
//                       + fallback /me/businesses → owned_ad_accounts/client_ad_accounts
// - listMetaPages: lista páginas Facebook conhecidas (tabela meta_pages)
// - selectMetaAdAccount: salva ad_account_id em integrations.account_metadata
// - selectMetaPage: salva fb_page_id em integrations.account_metadata
// - getMetaPublishReadiness: checklist agregado para a empresa (auto-resolve assets)
// - setMetaBetaFlag: liga/desliga meta_campaigns_beta (admin)
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

async function loadActiveMetaIntegrations(companyId: string): Promise<Integ[]> {
  // Usa admin client porque a tabela `integrations` tem SELECT revogado de
  // authenticated (para proteger access_token). RLS sozinho não basta — sem
  // GRANT a leitura volta vazia e cai em "no_integration".
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("integrations")
    .select("id, channel, access_token, account_metadata, external_account_id, display_name, active")
    .eq("company_id", companyId)
    .eq("active", true)
    .in("channel", ["instagram", "facebook"]);
  if (error) {
    console.error("[meta-ads] loadActiveMetaIntegrations error", error);
    return [];
  }
  const rows = ((data ?? []) as unknown as Integ[]).filter((i) => Boolean(i.access_token));
  console.log("[meta-ads] loadActiveMetaIntegrations", { companyId, total: data?.length ?? 0, withToken: rows.length });
  return rows;
}

function pickPrimaryIntegration(list: Integ[]): Integ | null {
  if (list.length === 0) return null;
  return (
    list.find((i) => Boolean((i.account_metadata ?? {})["ad_account_id"])) ??
    list[0]
  );
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

async function hasAdminRole(supabase: unknown, userId: string): Promise<boolean> {
  const sb = supabase as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: boolean | null }>;
  };
  const { data } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
  return Boolean(data);
}

type AdAcc = {
  id: string;
  account_id: string;
  name: string;
  status: number;
  currency: string;
  timezone: string;
  business: string | null;
  source: string;
};

async function fetchJSON(url: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const r = await fetch(url);
    const t = await r.text();
    let body: unknown = {};
    try { body = t ? JSON.parse(t) : {}; } catch { body = { _raw: t }; }
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: { error: { message: e instanceof Error ? e.message : "network" } } };
  }
}

async function gatherAdAccountsForToken(token: string): Promise<{ accounts: AdAcc[]; logs: string[] }> {
  const accounts: AdAcc[] = [];
  const logs: string[] = [];
  const fields = "id,account_id,name,account_status,currency,timezone_name,business{id,name}";

  // 1) /me/adaccounts
  const me = await fetchJSON(`${GRAPH}/me/adaccounts?fields=${fields}&limit=200&access_token=${encodeURIComponent(token)}`);
  if (me.ok) {
    const data = ((me.body as { data?: unknown[] }).data ?? []) as Array<Record<string, unknown>>;
    logs.push(`/me/adaccounts → ${data.length}`);
    for (const a of data) {
      accounts.push({
        id: String(a.id ?? ""),
        account_id: String((a.account_id as string) ?? String(a.id ?? "").replace(/^act_/, "")),
        name: String(a.name ?? a.id ?? ""),
        status: Number(a.account_status ?? 0),
        currency: String(a.currency ?? ""),
        timezone: String(a.timezone_name ?? ""),
        business: ((a.business as { name?: string } | undefined)?.name) ?? null,
        source: "me",
      });
    }
  } else {
    logs.push(`/me/adaccounts ERR ${me.status}: ${JSON.stringify((me.body as { error?: unknown }).error ?? me.body).slice(0, 200)}`);
  }

  // 2) /me/businesses → owned_ad_accounts + client_ad_accounts
  const biz = await fetchJSON(`${GRAPH}/me/businesses?fields=id,name&limit=50&access_token=${encodeURIComponent(token)}`);
  if (biz.ok) {
    const businesses = ((biz.body as { data?: unknown[] }).data ?? []) as Array<{ id?: string; name?: string }>;
    logs.push(`/me/businesses → ${businesses.length}`);
    for (const b of businesses) {
      if (!b.id) continue;
      for (const edge of ["owned_ad_accounts", "client_ad_accounts"] as const) {
        const r = await fetchJSON(`${GRAPH}/${b.id}/${edge}?fields=${fields}&limit=200&access_token=${encodeURIComponent(token)}`);
        if (r.ok) {
          const data = ((r.body as { data?: unknown[] }).data ?? []) as Array<Record<string, unknown>>;
          logs.push(`biz ${b.id}/${edge} → ${data.length}`);
          for (const a of data) {
            accounts.push({
              id: String(a.id ?? ""),
              account_id: String((a.account_id as string) ?? String(a.id ?? "").replace(/^act_/, "")),
              name: String(a.name ?? a.id ?? ""),
              status: Number(a.account_status ?? 0),
              currency: String(a.currency ?? ""),
              timezone: String(a.timezone_name ?? ""),
              business: b.name ?? null,
              source: `biz:${edge}`,
            });
          }
        } else {
          logs.push(`biz ${b.id}/${edge} ERR ${r.status}`);
        }
      }
    }
  } else {
    logs.push(`/me/businesses ERR ${biz.status}`);
  }

  return { accounts, logs };
}

async function fetchScopes(token: string): Promise<string[]> {
  try {
    const r = await fetchJSON(
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`,
    );
    if (!r.ok) return [];
    const scopes = ((r.body as { data?: { scopes?: string[] } }).data?.scopes) ?? [];
    return scopes;
  } catch { return []; }
}

// ----------------- LIST AD ACCOUNTS -----------------
export const listMetaAdAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const companyId = await getCompanyId(supabase as never, userId);
    if (!companyId) return { ok: false as const, error: "no_company" };

    const integrations = await loadActiveMetaIntegrations(companyId);
    if (integrations.length === 0) {
      return { ok: false as const, error: "no_integration", message: "Conecte uma conta Meta antes." };
    }

    // Agrega contas de todos os tokens.
    const seen = new Map<string, AdAcc>();
    const allLogs: string[] = [];
    const allScopes = new Set<string>();
    for (const integ of integrations) {
      const token = integ.access_token!;
      allLogs.push(`# integration ${integ.display_name ?? integ.id}`);
      const [{ accounts, logs }, scopes] = await Promise.all([
        gatherAdAccountsForToken(token),
        fetchScopes(token),
      ]);
      scopes.forEach((s) => allScopes.add(s));
      allLogs.push(...logs);
      for (const a of accounts) {
        if (!a.account_id) continue;
        if (!seen.has(a.account_id)) seen.set(a.account_id, a);
      }
    }

    const accounts = Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
    const primary = pickPrimaryIntegration(integrations)!;
    const selectedAdAccountId = String(((primary.account_metadata ?? {}) as Record<string, unknown>)["ad_account_id"] ?? "");
    const missingScopes = REQUIRED_SCOPES.filter((s) => !allScopes.has(s));

    // Server-side debug log (aparece em server-function-logs).
    console.log("[meta-ads] listMetaAdAccounts", {
      companyId,
      integrations: integrations.length,
      accountsFound: accounts.length,
      missingScopes,
      logs: allLogs,
    });

    return {
      ok: true as const,
      integrationId: primary.id,
      integrationName: primary.display_name ?? "",
      accounts,
      selectedAdAccountId,
      scopes: Array.from(allScopes),
      missingScopes,
      debug: allLogs,
    };
  });

// ----------------- LIST META PAGES -----------------
export const listMetaPages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const companyId = await getCompanyId(supabase as never, userId);
    if (!companyId) return { ok: false as const, error: "no_company" };

    const { data } = await supabase
      .from("meta_pages")
      .select("id, page_id, page_name, ig_business_account_id, ig_username, active, integration_id")
      .eq("company_id", companyId)
      .eq("active", true);

    const pages = (data ?? []) as Array<{
      id: string; page_id: string; page_name: string;
      ig_business_account_id: string | null; ig_username: string | null;
      active: boolean; integration_id: string | null;
    }>;

    const integrations = await loadActiveMetaIntegrations(companyId);
    const primary = pickPrimaryIntegration(integrations);
    const selectedPageId = primary
      ? String(((primary.account_metadata ?? {}) as Record<string, unknown>)["fb_page_id"] ?? primary.external_account_id ?? "")
      : "";

    return {
      ok: true as const,
      integrationId: primary?.id ?? null,
      pages,
      selectedPageId,
    };
  });

// ----------------- SELECT AD ACCOUNT -----------------
export const selectMetaAdAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        integrationId: z.string().uuid().optional(),
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

    const integrations = await loadActiveMetaIntegrations(companyId);
    const target = data.integrationId
      ? integrations.find((i) => i.id === data.integrationId)
      : pickPrimaryIntegration(integrations);
    if (!target) return { ok: false as const, error: "not_found", message: "Integração Meta não encontrada." };

    const normalized = data.adAccountId.startsWith("act_") ? data.adAccountId : `act_${data.adAccountId}`;
    const newMeta = { ...(target.account_metadata ?? {}), ad_account_id: normalized };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Propaga ad_account_id em TODAS integrações Meta da empresa (mesma conta de anúncios).
    const ids = integrations.map((i) => i.id);
    const updates = await Promise.all(ids.map(async (id) => {
      const current = integrations.find((i) => i.id === id)!;
      const meta = { ...(current.account_metadata ?? {}), ad_account_id: normalized };
      return supabaseAdmin.from("integrations").update({ account_metadata: meta }).eq("id", id).eq("company_id", companyId);
    }));
    const firstErr = updates.find((u) => u.error)?.error;
    if (firstErr) return { ok: false as const, error: "update_failed", message: firstErr.message };

    console.log("[meta-ads] selectMetaAdAccount saved", { companyId, adAccount: normalized, target: target.id, propagated: ids.length, newMeta });
    return { ok: true as const, adAccountId: normalized };
  });

// ----------------- CLEAR MANUAL AD ACCOUNT -----------------
export const clearMetaAdAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const companyId = await getCompanyId(supabase as never, userId);
    if (!companyId) return { ok: false as const, error: "no_company" };
    const isAdmin = await hasAdminRole(supabase, userId);
    if (!isAdmin) return { ok: false as const, error: "not_admin", message: "Apenas admin pode alterar." };

    const integrations = await loadActiveMetaIntegrations(companyId);
    if (integrations.length === 0) return { ok: true as const, cleared: 0 };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let cleared = 0;
    for (const integ of integrations) {
      const meta = { ...(integ.account_metadata ?? {}) } as Record<string, unknown>;
      if (!("ad_account_id" in meta)) continue;
      delete meta["ad_account_id"];
      const { error } = await supabaseAdmin
        .from("integrations")
        .update({ account_metadata: meta as never })
        .eq("id", integ.id)
        .eq("company_id", companyId);
      if (!error) cleared += 1;
    }
    console.log("[meta-ads] clearMetaAdAccount", { companyId, cleared });
    return { ok: true as const, cleared };
  });

// ----------------- SELECT PAGE -----------------
export const selectMetaPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      pageId: z.string().min(1).max(64).regex(/^[0-9]+$/),
      integrationId: z.string().uuid().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const companyId = await getCompanyId(supabase as never, userId);
    if (!companyId) return { ok: false as const, error: "no_company" };
    const isAdmin = await hasAdminRole(supabase, userId);
    if (!isAdmin) return { ok: false as const, error: "not_admin" };

    const integrations = await loadActiveMetaIntegrations(companyId);
    const target = data.integrationId
      ? integrations.find((i) => i.id === data.integrationId)
      : pickPrimaryIntegration(integrations);
    if (!target) return { ok: false as const, error: "not_found" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const newMeta = { ...(target.account_metadata ?? {}), fb_page_id: data.pageId };
    const { error } = await supabaseAdmin
      .from("integrations").update({ account_metadata: newMeta })
      .eq("id", target.id).eq("company_id", companyId);
    if (error) return { ok: false as const, error: "update_failed", message: error.message };

    console.log("[meta-ads] selectMetaPage saved", { companyId, pageId: data.pageId, target: target.id });
    return { ok: true as const, pageId: data.pageId };
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

    const integrations = await loadActiveMetaIntegrations(companyId);
    const integ = pickPrimaryIntegration(integrations);
    const meta = (integ?.account_metadata ?? {}) as Record<string, unknown>;
    const adAccountId = String(meta["ad_account_id"] ?? "");
    const pageId = String(meta["fb_page_id"] ?? integ?.external_account_id ?? "");
    const igId = String(meta["ig_business_account_id"] ?? "");

    // WhatsApp
    const { data: waList } = await supabase
      .from("integrations")
      .select("id, active, account_metadata, external_account_id")
      .eq("company_id", companyId)
      .eq("channel", "whatsapp")
      .eq("active", true);
    const waConnected = Array.isArray(waList) && waList.length > 0;

    console.log("[meta-ads] readiness", {
      companyId, integrations: integrations.length,
      primary: integ?.id, adAccountId, pageId, betaEnabled, waConnected,
    });

    return {
      ok: true as const,
      betaEnabled,
      isAdmin,
      metaConnected: Boolean(integ?.access_token),
      integrationId: integ?.id ?? null,
      integrationName: integ?.display_name ?? "",
      integrationCount: integrations.length,
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

    const { error } = await supabase
      .from("companies")
      .update({ meta_campaigns_beta: data.enabled } as never)
      .eq("id", companyId);
    if (error) return { ok: false as const, error: "update_failed", message: error.message };
    return { ok: true as const, enabled: data.enabled };
  });
