// Debug WhatsApp Cloud API: roda checagens contra a Graph API usando o token
// (temporário ou permanente) que o usuário cola. Retorna tudo em JSON cru.
//
// POST { accessToken, wabaId?, phoneNumberId?, toNumber?, testMessage? }
//   - /debug_token?input_token=USER  &access_token=APP_ID|APP_SECRET
//   - /me?fields=id,name
//   - /{wabaId}?fields=id,name,currency,timezone_id,message_template_namespace
//   - /{phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status
//   - POST /{phoneNumberId}/messages  (apenas se toNumber + testMessage)
//
// Não persiste nada. Não expõe APP_SECRET. Token do usuário é mascarado no log.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GRAPH = "https://graph.facebook.com/v20.0";

interface Body {
  accessToken: string;
  wabaId?: string;
  phoneNumberId?: string;
  toNumber?: string;
  testMessage?: string;
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
  if (!accessToken) return { error: Response.json({ error: "não autenticado" }, { status: 401 }) };
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) return { error: Response.json({ error: "sessão inválida" }, { status: 401 }) };
  return { userId: data.user.id };
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
        const userToken = String(body.accessToken ?? "").trim();
        if (!userToken) {
          return Response.json({ ok: false, error: "accessToken obrigatório" }, { status: 400 });
        }
        const wabaId = String(body.wabaId ?? "").trim();
        const phoneId = String(body.phoneNumberId ?? "").trim();
        const toNumber = String(body.toNumber ?? "").trim();
        const testMessage = String(body.testMessage ?? "").trim();

        const appId = process.env.META_APP_ID ?? "";
        const appSecret = process.env.META_APP_SECRET ?? "";

        console.log("[whatsapp debug] start", {
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
            : { status: 0, ok: false, body: { error: "META_APP_ID/META_APP_SECRET ausentes no servidor" } };

        const [meRes, wabaRes, phoneRes] = await Promise.all([
          gjson(`${GRAPH}/me?fields=id,name`, { headers }),
          wabaId
            ? gjson(
                `${GRAPH}/${encodeURIComponent(wabaId)}?fields=id,name,currency,timezone_id,message_template_namespace`,
                { headers },
              )
            : Promise.resolve({ status: 0, ok: false, body: { skipped: "wabaId não informado" } }),
          phoneId
            ? gjson(
                `${GRAPH}/${encodeURIComponent(phoneId)}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status`,
                { headers },
              )
            : Promise.resolve({ status: 0, ok: false, body: { skipped: "phoneNumberId não informado" } }),
        ]);

        let sendRes: { status: number; ok: boolean; body: unknown } | { skipped: string } = {
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

        return Response.json({
          ok: true,
          appIdUsed: appId,
          tokenPrefix: userToken.slice(0, 8),
          tokenLength: userToken.length,
          debug_token: debugTokenRes,
          me: meRes,
          waba: wabaRes,
          phone_number: phoneRes,
          test_send: sendRes,
        });
      },
    },
  },
});
