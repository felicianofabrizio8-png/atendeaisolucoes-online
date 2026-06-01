// Debug WhatsApp Cloud API.
// Modo 1 (token colado): POST { accessToken, wabaId?, phoneNumberId?, toNumber?, testMessage? }
// Modo 2 (integração salva): POST { useSaved: true, toNumber?, testMessage? }
//   - carrega integração WhatsApp ativa da empresa do usuário autenticado
//   - usa access_token + external_account_id salvos
//   - compara whatsapp_business_account.id retornado pela Meta com
//     account_metadata.waba_id salvo no banco e devolve diagnóstico
//
// Roda:
//   - /debug_token?input_token=USER&access_token=APP_ID|APP_SECRET
//   - /me?fields=id,name
//   - /{wabaId}?fields=id,name,currency,timezone_id,message_template_namespace
//   - /{phoneNumberId}?fields=id,display_phone_number,verified_name,
//                              quality_rating,code_verification_status,
//                              whatsapp_business_account{id,name}
//   - POST /{phoneNumberId}/messages  (apenas se toNumber + testMessage)
//
// Não persiste nada. Não expõe APP_SECRET. Token mascarado no log.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GRAPH = "https://graph.facebook.com/v20.0";

interface Body {
  accessToken?: string;
  wabaId?: string;
  phoneNumberId?: string;
  toNumber?: string;
  testMessage?: string;
  useSaved?: boolean;
}

async function gjson(url: string, init?: RequestInit) {
  let status = 0;
  let body: unknown = null;
  try {
    const res = await fetch(url, init);
    status = res.status;
    const text = await res.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  } catch (e) {
    body = { error: e instanceof Error ? e.message : "network error" };
  }
  return { status, ok: status >= 200 && status < 300, body };
}

async function authenticate(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const accessToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!accessToken)
    return { error: Response.json({ error: "não autenticado" }, { status: 401 }) };
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user)
    return { error: Response.json({ error: "sessão inválida" }, { status: 401 }) };
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("company_id")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile?.company_id)
    return { error: Response.json({ error: "perfil sem empresa" }, { status: 403 }) };
  return { userId: data.user.id, companyId: profile.company_id };
}

export const Route = createFileRoute("/api/whatsapp/debug")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticate(request);
        if ("error" in auth) return auth.error;

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
        }

        let userToken = String(body.accessToken ?? "").trim();
        let wabaId = String(body.wabaId ?? "").trim();
        let phoneId = String(body.phoneNumberId ?? "").trim();
        const toNumber = String(body.toNumber ?? "").trim();
        const testMessage = String(body.testMessage ?? "").trim();
        const useSaved = !!body.useSaved || !userToken;

        // savedIntegration: linha do banco que usamos para comparar
        let savedSnapshot: {
          id: string;
          external_account_id: string | null;
          saved_waba_id: string | null;
          token_expires_at: string | null;
          last_synced_at: string | null;
          active: boolean;
        } | null = null;

        if (useSaved) {
          const { data: integ, error: integErr } = await supabaseAdmin
            .from("integrations")
            .select("id, access_token, external_account_id, account_metadata, token_expires_at, last_synced_at, active")
            .eq("company_id", auth.companyId)
            .eq("channel", "whatsapp")
            .order("active", { ascending: false })
            .order("last_synced_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (integErr) {
            return Response.json(
              { ok: false, error: integErr.message },
              { status: 500 },
            );
          }
          if (!integ?.access_token || !integ.external_account_id) {
            return Response.json(
              {
                ok: false,
                error:
                  "Nenhuma integração WhatsApp salva para esta empresa. Reconecte a Meta primeiro.",
              },
              { status: 404 },
            );
          }
          userToken = integ.access_token;
          phoneId = phoneId || integ.external_account_id;
          const meta = (integ.account_metadata ?? {}) as Record<string, unknown>;
          const savedWaba =
            (typeof meta.waba_id === "string" && meta.waba_id) ||
            (typeof meta.verified_waba_id === "string" && (meta.verified_waba_id as string)) ||
            "";
          wabaId = wabaId || savedWaba;
          savedSnapshot = {
            id: integ.id,
            external_account_id: integ.external_account_id,
            saved_waba_id: savedWaba || null,
            token_expires_at: integ.token_expires_at,
            last_synced_at: integ.last_synced_at,
            active: integ.active,
          };
        }

        if (!userToken) {
          return Response.json(
            { ok: false, error: "accessToken obrigatório (ou useSaved=true)" },
            { status: 400 },
          );
        }

        const appId = process.env.META_APP_ID ?? "";
        const appSecret = process.env.META_APP_SECRET ?? "";

        console.log("[whatsapp debug] start", {
          mode: useSaved ? "saved" : "manual",
          companyId: auth.companyId,
          tokenPrefix: userToken.slice(0, 8),
          tokenLen: userToken.length,
          hasAppId: !!appId,
          hasAppSecret: !!appSecret,
          wabaId: wabaId || null,
          phoneId: phoneId || null,
          willSendTest: !!(phoneId && toNumber && testMessage),
        });

        const headers = { Authorization: `Bearer ${userToken}` };

        const debugTokenRes =
          appId && appSecret
            ? await gjson(
                `${GRAPH}/debug_token?input_token=${encodeURIComponent(userToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
              )
            : {
                status: 0,
                ok: false,
                body: { error: "META_APP_ID/META_APP_SECRET ausentes no servidor" },
              };

        const [meRes, wabaRes, phoneRes, subsRes, billingRes] = await Promise.all([
          gjson(`${GRAPH}/me?fields=id,name`, { headers }),
          wabaId
            ? gjson(
                `${GRAPH}/${encodeURIComponent(wabaId)}?fields=id,name,currency,timezone_id,message_template_namespace`,
                { headers },
              )
            : Promise.resolve({
                status: 0,
                ok: false,
                body: { skipped: "wabaId não informado" },
              }),
          phoneId
            ? gjson(
                `${GRAPH}/${encodeURIComponent(phoneId)}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,whatsapp_business_account{id,name}`,
                { headers },
              )
            : Promise.resolve({
                status: 0,
                ok: false,
                body: { skipped: "phoneNumberId não informado" },
              }),
          wabaId
            ? gjson(`${GRAPH}/${encodeURIComponent(wabaId)}/subscribed_apps`, { headers })
            : Promise.resolve({ status: 0, ok: false, body: { skipped: "no waba" } }),
          wabaId
            ? gjson(
                `${GRAPH}/${encodeURIComponent(wabaId)}?fields=account_review_status,business_verification_status`,
                { headers },
              )
            : Promise.resolve({ status: 0, ok: false, body: { skipped: "no waba" } }),
        ]);

        const subsBody = (subsRes as { body?: unknown }).body as
          | { data?: unknown[] }
          | undefined;
        const webhookSubscribed =
          (subsRes as { ok?: boolean }).ok === true &&
          Array.isArray(subsBody?.data) &&
          (subsBody!.data!.length ?? 0) > 0;

        const wabaBodyForBilling = (wabaRes as { body?: unknown }).body as
          | { currency?: string }
          | undefined;
        const billingBody = (billingRes as { body?: unknown }).body as
          | { account_review_status?: string; business_verification_status?: string }
          | undefined;
        const billingLikelyOk =
          !!wabaBodyForBilling?.currency &&
          (billingBody?.account_review_status ?? "").toUpperCase() !== "REJECTED";



        // Comparação WABA: real (vindo do phone_number) x salva no banco x informada
        const phoneBody = (phoneRes as { body?: unknown }).body as
          | { whatsapp_business_account?: { id?: string; name?: string } }
          | undefined;
        const realWabaId = phoneBody?.whatsapp_business_account?.id ?? null;
        const savedWabaId = savedSnapshot?.saved_waba_id ?? null;

        const comparison = {
          phone_number_id: phoneId || null,
          real_waba_id_from_meta: realWabaId,
          saved_waba_id_in_db: savedWabaId,
          requested_waba_id: wabaId || null,
          phone_belongs_to_token:
            (phoneRes as { ok?: boolean }).ok === true && !!realWabaId,
          waba_matches_saved:
            realWabaId && savedWabaId ? realWabaId === savedWabaId : null,
          waba_matches_requested:
            realWabaId && wabaId ? realWabaId === wabaId : null,
          verdict: (() => {
            const phoneOk = (phoneRes as { ok?: boolean }).ok === true;
            if (!phoneOk)
              return "TOKEN_INVALID_OR_NO_PERMISSION_ON_PHONE_NUMBER";
            if (savedWabaId && realWabaId && savedWabaId !== realWabaId)
              return "WABA_MISMATCH_SAVED_VS_META";
            if (wabaId && realWabaId && wabaId !== realWabaId)
              return "WABA_MISMATCH_REQUESTED_VS_META";
            if (!savedWabaId && useSaved) return "SAVED_WABA_MISSING";
            return "OK";
          })(),
        };

        let sendRes:
          | { status: number; ok: boolean; body: unknown }
          | { skipped: string } = {
          skipped: "toNumber/testMessage não informados",
        };
        if (phoneId && toNumber && testMessage) {
          sendRes = await gjson(`${GRAPH}/${encodeURIComponent(phoneId)}/messages`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: toNumber.replace(/\D/g, ""),
              type: "text",
              text: { body: testMessage },
            }),
          });
        }

        console.log("[whatsapp debug] verdict", {
          verdict: comparison.verdict,
          realWabaId,
          savedWabaId,
          requested: wabaId || null,
        });

        return Response.json({
          ok: true,
          mode: useSaved ? "saved_integration" : "manual_token",
          appIdUsed: appId,
          tokenPrefix: userToken.slice(0, 8),
          tokenLength: userToken.length,
          saved_integration: savedSnapshot,
          debug_token: debugTokenRes,
          me: meRes,
          waba: wabaRes,
          phone_number: phoneRes,
          comparison,
          test_send: sendRes,
        });
      },
    },
  },
});
