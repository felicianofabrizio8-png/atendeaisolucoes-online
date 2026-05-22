// Envia uma mensagem de TESTE via WhatsApp Cloud API e devolve a resposta crua
// da Meta para inspeção. Não persiste em conversations/messages — só registra
// no log do servidor e atualiza last_synced_at/last_error da integração.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
        if (!integration.access_token || !integration.external_account_id) {
          return Response.json(
            { error: "integração sem token ou phone_number_id" },
            { status: 400 },
          );
        }

        const url = `https://graph.facebook.com/v20.0/${integration.external_account_id}/messages`;
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
          body: respText.slice(0, 500),
        });

        if (ok) {
          await supabaseAdmin
            .from("integrations")
            .update({ last_synced_at: startedAt, last_error: null })
            .eq("id", integrationId);
        } else {
          const errMsg =
            (respJson as { error?: { message?: string } })?.error?.message ??
            `HTTP ${status}`;
          await supabaseAdmin
            .from("integrations")
            .update({ last_error: `teste: ${errMsg}` })
            .eq("id", integrationId);
        }

        return Response.json({
          ok,
          status,
          request: { url, payload },
          response: respJson ?? respText,
        });
      },
    },
  },
});
