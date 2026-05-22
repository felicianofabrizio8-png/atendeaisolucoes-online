// Edge Function: meta-connect  (Facebook Login callback)
// Recebe { shortLivedToken, pages: [{id,name,access_token}] }, faz exchange para
// long-lived user token, busca page tokens definitivos + IG business account vinculado,
// salva em integrations + meta_pages e assina os campos do webhook.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.facebook.com/v21.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const SUBSCRIBED_FIELDS = [
  "messages",
  "messaging_postbacks",
  "message_reactions",
  "feed",
  "comments",
].join(",");

async function exchangeForLongLivedUserToken(shortToken: string): Promise<{
  access_token: string;
  expires_in?: number;
} | null> {
  const url =
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(META_APP_ID)}` +
    `&client_secret=${encodeURIComponent(META_APP_SECRET)}` +
    `&fb_exchange_token=${encodeURIComponent(shortToken)}`;
  const r = await fetch(url);
  if (!r.ok) {
    console.log("LONG_LIVED_EXCHANGE_FAIL", r.status, await r.text());
    return null;
  }
  return await r.json();
}

async function getPageDetails(pageId: string, longUserToken: string) {
  // page access token + IG business account in one call
  const url =
    `${GRAPH}/${pageId}?fields=name,access_token,instagram_business_account{id,username}` +
    `&access_token=${encodeURIComponent(longUserToken)}`;
  const r = await fetch(url);
  if (!r.ok) {
    console.log("PAGE_DETAILS_FAIL", pageId, r.status, await r.text());
    return null;
  }
  return await r.json();
}

async function subscribePage(pageId: string, pageToken: string) {
  const url = `${GRAPH}/${pageId}/subscribed_apps`;
  const body = new URLSearchParams({
    subscribed_fields: SUBSCRIBED_FIELDS,
    access_token: pageToken,
  });
  const r = await fetch(url, { method: "POST", body });
  const text = await r.text();
  console.log("SUBSCRIBE_PAGE", pageId, r.status, text.slice(0, 300));
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const authHeader = req.headers.get("Authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!accessToken) return json({ ok: false, error: "unauthorized" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRes, error: userErr } = await sb.auth.getUser(accessToken);
  if (userErr || !userRes.user) return json({ ok: false, error: "invalid session" }, 401);

  const { data: profile } = await sb
    .from("profiles").select("company_id").eq("id", userRes.user.id).maybeSingle();
  const companyId = profile?.company_id;
  if (!companyId) return json({ ok: false, error: "profile without company" }, 403);

  if (req.method === "GET") {
    const { data } = await sb
      .from("meta_pages")
      .select("id, page_id, page_name, ig_business_account_id, ig_username, active, token_expires_at, last_error")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });
    return json({ ok: true, pages: data ?? [] });
  }

  if (req.method === "DELETE") {
    const { pageId } = await req.json().catch(() => ({ pageId: null }));
    if (!pageId) return json({ ok: false, error: "missing pageId" }, 400);
    await sb.from("meta_pages").delete().eq("company_id", companyId).eq("page_id", pageId);
    return json({ ok: true });
  }

  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  let payload: { shortLivedToken?: string; pages?: Array<{ id: string; name: string }> };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  const shortToken = String(payload.shortLivedToken ?? "");
  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  if (!shortToken || pages.length === 0) {
    return json({ ok: false, error: "shortLivedToken and pages required" }, 400);
  }

  const longLived = await exchangeForLongLivedUserToken(shortToken);
  if (!longLived?.access_token) {
    return json({ ok: false, error: "failed to exchange long-lived token" }, 400);
  }
  const longUserToken = longLived.access_token;
  const userTokenExpiresAt = longLived.expires_in
    ? new Date(Date.now() + longLived.expires_in * 1000).toISOString()
    : null;

  const results: Array<{ page_id: string; ok: boolean; error?: string; ig?: string | null }> = [];

  for (const p of pages) {
    try {
      const details = await getPageDetails(p.id, longUserToken);
      if (!details?.access_token) {
        results.push({ page_id: p.id, ok: false, error: "no page access_token" });
        continue;
      }

      const pageToken: string = details.access_token;
      const pageName: string = details.name ?? p.name;
      const ig = details.instagram_business_account?.id ?? null;
      const igUsername = details.instagram_business_account?.username ?? null;

      // Upsert integration row (one per page).
      const { data: integ } = await sb
        .from("integrations")
        .upsert(
          {
            company_id: companyId,
            channel: ig ? "instagram" : "facebook",
            display_name: pageName,
            external_account_id: p.id,
            access_token: pageToken,
            token_expires_at: userTokenExpiresAt,
            active: true,
            account_metadata: { ig_business_account_id: ig, ig_username: igUsername },
            last_error: null,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: "company_id,channel,external_account_id" },
        )
        .select("id")
        .maybeSingle();

      await sb
        .from("meta_pages")
        .upsert(
          {
            company_id: companyId,
            integration_id: integ?.id ?? null,
            page_id: p.id,
            page_name: pageName,
            ig_business_account_id: ig,
            ig_username: igUsername,
            page_access_token: pageToken,
            token_expires_at: userTokenExpiresAt,
            active: true,
            last_error: null,
          },
          { onConflict: "company_id,page_id" },
        );

      const subOk = await subscribePage(p.id, pageToken);
      results.push({ page_id: p.id, ok: subOk, ig: ig });
    } catch (e) {
      results.push({ page_id: p.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return json({ ok: true, results });
});
