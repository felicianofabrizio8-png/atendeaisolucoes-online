// Edge Function: meta-connect  (Facebook Login callback)
// Recebe { shortLivedToken, pages: [{id,name,access_token}] }, faz exchange para
// long-lived user token, busca page tokens definitivos + IG business account vinculado,
// salva em integrations + meta_pages e assina os campos do webhook.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const META_APP_ID = Deno.env.get("META_APP_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.facebook.com/v25.0";

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

  let payload: {
    mode?: string;
    shortLivedToken?: string;
    userID?: string;
    page?: {
      id: string;
      name: string;
      access_token: string;
      ig_business_account_id?: string | null;
      ig_username?: string | null;
    };
    pages?: Array<{ id: string; name: string }>;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }

  const shortToken = String(payload.shortLivedToken ?? "");
  if (!shortToken) {
    return json({ ok: false, error: "shortLivedToken required" }, 400);
  }

  // Modo debug_token: valida o user token usando APP_ID|APP_SECRET do app Atende Ai
  // e retorna /me + /me/accounts para comparação. Nunca falha se /debug_token der erro.
  if (payload.mode === "debug_token") {
    const appToken = `${META_APP_ID}|${META_APP_SECRET}`;
    console.log("META_APP_ID_USED", META_APP_ID);
    console.log("META_DEBUG_INPUT_TOKEN_PREFIX", shortToken.slice(0, 8));
    console.log("META_DEBUG_APP_TOKEN_PREFIX", `${META_APP_ID}|${META_APP_SECRET.slice(0, 4)}...`);

    const tok = encodeURIComponent(shortToken);
    const appTokEnc = encodeURIComponent(appToken);

    const [debugRes, meRes, accountsRes] = await Promise.all([
      fetch(`${GRAPH}/debug_token?input_token=${tok}&access_token=${appTokEnc}`)
        .then(async (r) => ({ status: r.status, ok: r.ok, body: await r.json().catch(() => null) }))
        .catch((e) => ({ status: 0, ok: false, body: { error: String(e) } })),
      fetch(`${GRAPH}/me?fields=id,name&access_token=${tok}`)
        .then(async (r) => ({ status: r.status, ok: r.ok, body: await r.json().catch(() => null) }))
        .catch((e) => ({ status: 0, ok: false, body: { error: String(e) } })),
      fetch(
        `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${tok}`,
      )
        .then(async (r) => ({ status: r.status, ok: r.ok, body: await r.json().catch(() => null) }))
        .catch((e) => ({ status: 0, ok: false, body: { error: String(e) } })),
    ]);

    console.log("META_DEBUG_RESULTS", {
      debug_token_status: debugRes.status,
      debug_token_ok: debugRes.ok,
      me_status: meRes.status,
      accounts_status: accountsRes.status,
    });

    const d = (debugRes.body as { data?: Record<string, unknown> } | null)?.data ?? null;
    const debugFailed = !debugRes.ok || !d;
    const accountsBody = accountsRes.body as { data?: unknown[] } | null;
    const accountsCount = Array.isArray(accountsBody?.data) ? accountsBody!.data!.length : 0;

    return json({
      ok: true,
      app_id_used: META_APP_ID,
      debug_failed: debugFailed,
      debug_warning: debugFailed
        ? "Validação /debug_token falhou — APP_ID/APP_SECRET podem não corresponder ao app que emitiu o token. /me e /me/accounts ainda exibidos para comparação."
        : null,
      debug_token: d
        ? {
            app_id: d.app_id ?? null,
            user_id: d.user_id ?? null,
            type: d.type ?? null,
            scopes: d.scopes ?? null,
            granular_scopes: d.granular_scopes ?? null,
            data_access_expires_at: d.data_access_expires_at ?? null,
            expires_at: d.expires_at ?? null,
            is_valid: d.is_valid ?? null,
            application: d.application ?? null,
          }
        : null,
      debug_token_raw: debugRes.body,
      me: meRes.body,
      me_accounts: accountsRes.body,
      me_accounts_count: accountsCount,
      token_preview: `${shortToken.slice(0, 12)}...${shortToken.slice(-6)}`,
    });
  }

  // Modo básico: apenas valida o login e salva um registro de teste.
  if (payload.mode === "basic") {
    const meRes = await fetch(
      `${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(shortToken)}`,
    );
    if (!meRes.ok) {
      const text = await meRes.text();
      console.log("ME_FAIL", meRes.status, text);
      return json({ ok: false, error: "failed to fetch user profile" }, 400);
    }
    const me = (await meRes.json()) as { id: string; name?: string };

    await sb.from("integrations").upsert(
      {
        company_id: companyId,
        channel: "facebook",
        display_name: me.name ?? "Meta Test User",
        external_account_id: `user:${me.id}`,
        access_token: shortToken,
        active: true,
        account_metadata: { mode: "basic", fb_user_id: me.id },
        last_error: null,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "company_id,channel,external_account_id" },
    );

    return json({ ok: true, user: { id: me.id, name: me.name } });
  }

  // Modo connect_page (Etapa 2): conecta uma página Facebook + Instagram vinculado.
  if (payload.mode === "connect_page") {
    const page = payload.page as
      | {
          id: string;
          name: string;
          access_token: string;
          ig_business_account_id?: string | null;
          ig_username?: string | null;
        }
      | undefined;
    if (!page?.id || !page?.access_token) {
      return json({ ok: false, error: "page required" }, 400);
    }

    // Troca por long-lived user token (60 dias)
    const longLived = await exchangeForLongLivedUserToken(shortToken);
    const longUserToken = longLived?.access_token ?? shortToken;
    const userTokenExpiresAt = longLived?.expires_in
      ? new Date(Date.now() + longLived.expires_in * 1000).toISOString()
      : null;

    console.log("META_CONNECT_PAGE_TOKEN", {
      page_id: page.id,
      has_long_lived: Boolean(longLived?.access_token),
      long_token_preview: longUserToken
        ? `${longUserToken.slice(0, 12)}...${longUserToken.slice(-6)}`
        : null,
      expires_at: userTokenExpiresAt,
    });

    // Obtém page token long-lived + IG vinculado em uma chamada.
    const graphUrl =
      `${GRAPH}/${page.id}?fields=name,access_token,instagram_business_account{id,username}` +
      `&access_token=${encodeURIComponent(longUserToken)}`;
    const detailsRes = await fetch(graphUrl);
    const detailsText = await detailsRes.text();
    console.log("META_GRAPH_RESPONSE", {
      page_id: page.id,
      status: detailsRes.status,
      ok: detailsRes.ok,
      body: detailsText.slice(0, 2000),
    });
    if (!detailsRes.ok) {
      console.log("PAGE_TOKEN_FAIL", page.id, detailsRes.status, detailsText);
      return json({ ok: false, error: "failed to fetch page access token", details: detailsText }, 400);
    }
    const details = JSON.parse(detailsText) as {
      name?: string;
      access_token?: string;
      instagram_business_account?: { id?: string; username?: string };
    };
    const pageToken = details.access_token ?? page.access_token;
    const pageName = details.name ?? page.name;
    const igId =
      details.instagram_business_account?.id ?? page.ig_business_account_id ?? null;
    const igUsername =
      details.instagram_business_account?.username ?? page.ig_username ?? null;

    console.log("META_PAGE_FOUND", {
      page_id: page.id,
      page_name: pageName,
      has_page_token: Boolean(pageToken),
    });
    if (igId) {
      console.log("META_IG_FOUND", {
        page_id: page.id,
        ig_business_account_id: igId,
        ig_username: igUsername,
      });
    }

    const { data: integ, error: integErr } = await sb
      .from("integrations")
      .upsert(
        {
          company_id: companyId,
          channel: igId ? "instagram" : "facebook",
          display_name: pageName,
          external_account_id: page.id,
          access_token: pageToken,
          token_expires_at: userTokenExpiresAt,
          active: true,
          account_metadata: {
            mode: "page",
            fb_page_id: page.id,
            ig_business_account_id: igId,
            ig_username: igUsername,
          },
          last_error: null,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "company_id,channel,external_account_id" },
      )
      .select("id")
      .maybeSingle();

    if (integErr) {
      console.log("INTEG_UPSERT_FAIL", integErr);
      return json({ ok: false, error: integErr.message }, 500);
    }

    const { error: pageErr } = await sb.from("meta_pages").upsert(
      {
        company_id: companyId,
        integration_id: integ?.id ?? null,
        page_id: page.id,
        page_name: pageName,
        ig_business_account_id: igId,
        ig_username: igUsername,
        page_access_token: pageToken,
        token_expires_at: userTokenExpiresAt,
        active: true,
        last_error: null,
      },
      { onConflict: "company_id,page_id" },
    );

    if (pageErr) {
      console.log("PAGE_UPSERT_FAIL", pageErr);
      return json({ ok: false, error: pageErr.message }, 500);
    }
    console.log("META_TOKEN_SAVED", { page_id: page.id, integration_id: integ?.id });

    // Assina a página aos eventos do webhook (Messenger + Feed/Comments + IG).
    const webhookOk = await subscribePage(page.id, pageToken);
    console.log("META_WEBHOOK_SUBSCRIBED", { page_id: page.id, ok: webhookOk });

    if (!webhookOk) {
      await sb
        .from("meta_pages")
        .update({ last_error: "Falha ao assinar webhook (subscribed_apps)" })
        .eq("company_id", companyId)
        .eq("page_id", page.id);
    }

    return json({
      ok: true,
      webhook_subscribed: webhookOk,
      page: {
        id: page.id,
        name: pageName,
        ig_business_account_id: igId,
        ig_username: igUsername,
        integration_id: integ?.id ?? null,
      },
    });
  }



  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  if (pages.length === 0) {
    return json({ ok: false, error: "pages required" }, 400);
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
