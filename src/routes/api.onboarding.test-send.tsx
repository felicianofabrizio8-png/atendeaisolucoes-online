// Wrapper isolado da Fase 4 do onboarding.
// Recebe { phone, text } do cliente, identifica company_id logado,
// confere se existe integração WhatsApp ativa e delega o envio
// para a Edge Function meta-send EXISTENTE (não altera meta-send).
// O access_token nunca volta para o frontend.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

interface Body {
  phone?: string;
  text?: string;
}

export const Route = createFileRoute("/api/onboarding/test-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        console.log("META_ONBOARDING_TEST_SEND_START");

        const authHeader = request.headers.get("authorization") ?? "";
        const accessToken = authHeader.startsWith("Bearer ")
          ? authHeader.slice(7)
          : "";
        if (!accessToken) {
          return Response.json({ ok: false, error: "não autenticado" }, { status: 401 });
        }

        const { data: userRes, error: userErr } =
          await supabaseAdmin.auth.getUser(accessToken);
        if (userErr || !userRes?.user) {
          return Response.json({ ok: false, error: "sessão inválida" }, { status: 401 });
        }

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userRes.user.id)
          .maybeSingle();
        const companyId = profile?.company_id;
        if (!companyId) {
          return Response.json(
            { ok: false, error: "perfil sem empresa" },
            { status: 403 },
          );
        }

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
        }

        const phoneDigits = String(body.phone ?? "").replace(/\D/g, "");
        const text = String(body.text ?? "").trim();
        if (phoneDigits.length < 10 || phoneDigits.length > 15) {
          return Response.json(
            { ok: false, error: "Telefone inválido. Informe DDD + número." },
            { status: 400 },
          );
        }
        if (!text) {
          return Response.json(
            { ok: false, error: "Mensagem vazia." },
            { status: 400 },
          );
        }

        // Confere que existe integração WhatsApp ativa para essa empresa.
        const { data: integ } = await supabaseAdmin
          .from("integrations_safe")
          .select("id, channel, active, has_access_token, external_account_id")
          .eq("company_id", companyId)
          .eq("channel", "whatsapp")
          .eq("active", true)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!integ || !integ.has_access_token || !integ.external_account_id) {
          console.warn("META_ONBOARDING_TEST_SEND_NO_INTEGRATION", { companyId });
          return Response.json(
            {
              ok: false,
              error:
                "Nenhuma integração WhatsApp ativa encontrada. Conclua o onboarding antes do teste.",
            },
            { status: 400 },
          );
        }

        // Delega para a Edge Function meta-send EXISTENTE (não modificar).
        const supabaseUrl =
          process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
        if (!supabaseUrl) {
          return Response.json(
            { ok: false, error: "SUPABASE_URL ausente no servidor" },
            { status: 500 },
          );
        }

        const fnUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/meta-send`;
        console.log("META_ONBOARDING_TEST_SEND_DISPATCH", {
          companyId,
          to: phoneDigits,
        });

        let upstream: Response;
        try {
          upstream = await fetch(fnUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              channel: "whatsapp",
              phone: phoneDigits,
              text,
            }),
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "erro de rede";
          console.error("META_ONBOARDING_TEST_SEND_NETWORK_ERROR", msg);
          return Response.json(
            { ok: false, error: `Falha de rede ao chamar meta-send: ${msg}` },
            { status: 502 },
          );
        }

        const raw = await upstream.text();
        let parsed: { ok?: boolean; error?: string; metaError?: { message?: string } } = {};
        try {
          parsed = JSON.parse(raw);
        } catch {
          /* upstream pode não ser JSON */
        }

        if (!upstream.ok || parsed.ok === false) {
          const errMsg =
            parsed.metaError?.message ||
            parsed.error ||
            `Erro Meta (HTTP ${upstream.status})`;
          console.error("META_ONBOARDING_TEST_SEND_ERROR", {
            status: upstream.status,
            error: errMsg,
          });
          return Response.json(
            { ok: false, error: errMsg },
            { status: upstream.status >= 400 ? upstream.status : 502 },
          );
        }

        console.log("META_ONBOARDING_TEST_SEND_SUCCESS", { to: phoneDigits });
        return Response.json({ ok: true, to: phoneDigits });
      },
    },
  },
});
