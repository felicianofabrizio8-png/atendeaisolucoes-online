// Envia uma mensagem de TESTE via WhatsApp Cloud API e devolve a resposta crua
// da Meta para inspeção. Não persiste em conversations/messages — só registra
// no log do servidor e atualiza last_synced_at/last_error da integração.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { postGraph } from "@/lib/outbound/MetaOutbound.server";
import { isSimulation, isRealDelivery } from "@/lib/outbound/MetaOutboundContract";

interface Body {
  integrationId: string;
  to: string;
  text?: string;
}

export const Route = createFileRoute("/api/whatsapp/test-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const accessToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!accessToken) {
          return Response.json({ error: "não autenticado" }, { status: 401 });
        }
        const { data: userRes, error: userErr } =
          await supabaseAdmin.auth.getUser(accessToken);
        if (userErr || !userRes.user) {
          return Response.json({ error: "sessão inválida" }, { status: 401 });
        }
        const userId = userRes.user.id;

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }
        const integrationId = String(body.integrationId ?? "").trim();
        const toRaw = String(body.to ?? "").trim();
        const text =
          (typeof body.text === "string" && body.text.trim()) ||
          "Mensagem de teste do Atende AI ✅";
        const to = toRaw.replace(/\D/g, "");
        if (!integrationId || !to || to.length < 8 || to.length > 15) {
          return Response.json(
            { error: "integrationId e telefone (apenas dígitos) obrigatórios" },
            { status: 400 },
          );
        }

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userId)
          .maybeSingle();
        if (!profile?.company_id) {
          return Response.json({ error: "perfil sem empresa" }, { status: 403 });
        }

        const { data: integration } = await supabaseAdmin
          .from("integrations")
          .select("id, company_id, channel, access_token, external_account_id")
          .eq("id", integrationId)
          .maybeSingle();
        if (
          !integration ||
          integration.company_id !== profile.company_id ||
          integration.channel !== "whatsapp"
        ) {
          return Response.json({ error: "integração não encontrada" }, { status: 404 });
        }
        const tokenSaved = Boolean(
          integration.access_token && integration.access_token.trim().length > 0,
        );
        const phoneNumberId = integration.external_account_id ?? "";
        const tokenPrefix = tokenSaved
          ? integration.access_token!.slice(0, 6)
          : null;

        // Log seguro: NUNCA logar o token inteiro.
        console.log("[whatsapp test-send] credentials", {
          integrationId,
          phoneNumberId,
          tokenSaved: tokenSaved ? "Yes" : "No",
          tokenPrefix: tokenPrefix ?? "N/A",
        });

        if (!tokenSaved || !phoneNumberId) {
          return Response.json(
            {
              ok: false,
              error:
                "Token da WhatsApp Cloud API inválido ou expirado. Reconfigure a integração.",
              diagnostics: {
                phoneNumberId,
                tokenSaved: tokenSaved ? "Yes" : "No",
                tokenPrefix: tokenPrefix ?? "N/A",
              },
            },
            { status: 400 },
          );
        }

        const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
        const payload = {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text },
        };
        const startedAt = new Date().toISOString();
        console.log("[whatsapp test-send] request", {
          integrationId,
          to,
          textLen: text.length,
          url,
        });

        let status = 0;
        let respJson: unknown = null;
        let respText = "";
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${integration.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });
          status = res.status;
          respText = await res.text();
          try {
            respJson = JSON.parse(respText);
          } catch {
            respJson = null;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "falha de rede";
          console.error("[whatsapp test-send] network error", msg);
          await supabaseAdmin
            .from("integrations")
            .update({ last_error: `teste: ${msg}` })
            .eq("id", integrationId);
          return Response.json({ ok: false, error: msg }, { status: 502 });
        }

        const ok = status >= 200 && status < 300;
        console.log("[whatsapp test-send] response", {
          status,
          ok,
          phoneNumberId,
          tokenPrefix,
          body: respText.slice(0, 1000),
        });

        const metaError = (respJson as {
          error?: { message?: string; code?: number; type?: string };
        })?.error;

        // Detecta 401 / OAuthException / código 190 (token expirado/inválido)
        const isAuthError =
          status === 401 ||
          metaError?.type === "OAuthException" ||
          metaError?.code === 190 ||
          metaError?.code === 102;

        if (ok) {
          await supabaseAdmin
            .from("integrations")
            .update({ last_synced_at: startedAt, last_error: null })
            .eq("id", integrationId);
        } else {
          const errMsg = metaError?.message ?? `HTTP ${status}`;
          await supabaseAdmin
            .from("integrations")
            .update({ last_error: `teste: ${errMsg}` })
            .eq("id", integrationId);
        }

        const friendlyError = isAuthError
          ? "Token da WhatsApp Cloud API inválido ou expirado. Reconfigure a integração."
          : ok
            ? undefined
            : metaError?.message ?? `HTTP ${status}`;

        return Response.json({
          ok,
          status,
          error: friendlyError,
          diagnostics: {
            phoneNumberId,
            tokenSaved: "Yes",
            tokenPrefix,
            endpoint: url,
          },
          request: { url, payload },
          response: respJson ?? respText,
        });
      },
    },
  },
});

