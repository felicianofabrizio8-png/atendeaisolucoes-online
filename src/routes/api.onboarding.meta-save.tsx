// Endpoint isolado da Fase 3 do onboarding.
// Salva uma integração WhatsApp Cloud oficial (Meta) por empresa.
// NÃO altera meta-webhook, meta-send, integrações antigas nem Evolution.
// O access_token chega aqui via POST autenticado, é validado server-side,
// gravado em integrations.access_token (service role) e nunca devolvido ao cliente.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GRAPH = "https://graph.facebook.com/v25.0";

interface SaveBody {
  access_token: string;
  selected_page_id?: string | null;
  selected_waba_id: string;
  selected_phone_number_id: string;
  selected_phone_number?: string | null;
  selected_phone_verified_name?: string | null;
  selected_business_id?: string | null;
  selected_instagram_id?: string | null;
  selected_instagram_username?: string | null;
  selected_page_name?: string | null;
}

async function authenticate(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";
  if (!accessToken) {
    return { error: Response.json({ error: "não autenticado" }, { status: 401 }) };
  }
  const { data: userRes, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !userRes.user) {
    return { error: Response.json({ error: "sessão inválida" }, { status: 401 }) };
  }
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("company_id")
    .eq("id", userRes.user.id)
    .maybeSingle();
  if (!profile?.company_id) {
    return { error: Response.json({ error: "perfil sem empresa" }, { status: 403 }) };
  }
  return { userId: userRes.user.id, companyId: profile.company_id };
}

export const Route = createFileRoute("/api/onboarding/meta-save")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        console.log("META_ONBOARDING_SAVE_START");

        const auth = await authenticate(request);
        if ("error" in auth) return auth.error;
        console.log("META_ONBOARDING_COMPANY_FOUND", { companyId: auth.companyId });

        let body: SaveBody;
        try {
          body = (await request.json()) as SaveBody;
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }

        if (
          !body.access_token?.trim() ||
          !body.selected_waba_id?.trim() ||
          !body.selected_phone_number_id?.trim()
        ) {
          return Response.json(
            {
              error:
                "campos obrigatórios: access_token, selected_waba_id, selected_phone_number_id",
            },
            { status: 400 },
          );
        }

        // Valida token e tenta enriquecer dados do número diretamente na Meta.
        let phoneInfo: {
          display_phone_number?: string;
          verified_name?: string;
        } = {};
        try {
          const tok = encodeURIComponent(body.access_token);
          const meRes = await fetch(`${GRAPH}/me?fields=id,name&access_token=${tok}`);
          const meJson = (await meRes.json()) as { id?: string; error?: { message?: string } };
          if (!meRes.ok || meJson.error) {
            console.error("META_ONBOARDING_SAVE_ERROR", {
              stage: "validate_token",
              error: meJson.error,
            });
            return Response.json(
              { error: meJson.error?.message ?? "Token Meta inválido" },
              { status: 400 },
            );
          }
          console.log("META_ONBOARDING_TOKEN_VALID", { meId: meJson.id });

          const phRes = await fetch(
            `${GRAPH}/${encodeURIComponent(body.selected_phone_number_id)}?fields=display_phone_number,verified_name&access_token=${tok}`,
          );
          const phJson = (await phRes.json()) as {
            display_phone_number?: string;
            verified_name?: string;
            error?: { message?: string };
          };
          if (phRes.ok && !phJson.error) {
            phoneInfo = {
              display_phone_number: phJson.display_phone_number,
              verified_name: phJson.verified_name,
            };
          }
        } catch (e) {
          console.error("META_ONBOARDING_SAVE_ERROR", { stage: "validate_token_exception", e });
          return Response.json({ error: "Falha ao validar token Meta" }, { status: 400 });
        }

        const phoneNumber =
          phoneInfo.display_phone_number ?? body.selected_phone_number ?? null;
        const verifiedName =
          phoneInfo.verified_name ?? body.selected_phone_verified_name ?? null;

        const displayName =
          verifiedName ?? phoneNumber ?? `WhatsApp ${body.selected_phone_number_id}`;

        const accountMetadata = {
          phone_number: phoneNumber,
          verified_name: verifiedName,
          waba_id: body.selected_waba_id,
          page_id: body.selected_page_id ?? null,
          page_name: body.selected_page_name ?? null,
          business_id: body.selected_business_id ?? null,
          instagram_business_account_id: body.selected_instagram_id ?? null,
          instagram_username: body.selected_instagram_username ?? null,
          onboarded_via: "meta_whatsapp_cloud",
          onboarded_at: new Date().toISOString(),
        };

        // Upsert integration (chave: company_id + channel + external_account_id=phone_number_id)
        const { data: existing, error: existingErr } = await supabaseAdmin
          .from("integrations")
          .select("id")
          .eq("company_id", auth.companyId)
          .eq("channel", "whatsapp")
          .eq("external_account_id", body.selected_phone_number_id)
          .maybeSingle();
        if (existingErr) {
          console.error("META_ONBOARDING_SAVE_ERROR", { stage: "integ_lookup", existingErr });
          return Response.json({ error: existingErr.message }, { status: 500 });
        }

        const integrationPayload = {
          company_id: auth.companyId,
          channel: "whatsapp" as const,
          display_name: displayName,
          active: true,
          external_account_id: body.selected_phone_number_id,
          account_metadata: accountMetadata,
          access_token: body.access_token,
          last_synced_at: new Date().toISOString(),
          last_error: null,
        };

        let integrationId: string | null = null;
        if (existing?.id) {
          const { data, error } = await supabaseAdmin
            .from("integrations")
            .update(integrationPayload)
            .eq("id", existing.id)
            .select("id")
            .single();
          if (error || !data) {
            console.error("META_ONBOARDING_SAVE_ERROR", { stage: "integ_update", error });
            return Response.json({ error: error?.message ?? "Falha ao atualizar" }, { status: 500 });
          }
          integrationId = data.id;
        } else {
          const { data, error } = await supabaseAdmin
            .from("integrations")
            .insert(integrationPayload)
            .select("id")
            .single();
          if (error || !data) {
            console.error("META_ONBOARDING_SAVE_ERROR", { stage: "integ_insert", error });
            return Response.json({ error: error?.message ?? "Falha ao inserir" }, { status: 500 });
          }
          integrationId = data.id;
        }

        console.log("META_ONBOARDING_INTEGRATION_SAVED", {
          integrationId,
          companyId: auth.companyId,
          phoneNumberId: body.selected_phone_number_id,
          wabaId: body.selected_waba_id,
        });

        // meta_pages (opcional) — só se houver page_id selecionada
        if (body.selected_page_id) {
          try {
            const { data: pageExisting } = await supabaseAdmin
              .from("meta_pages")
              .select("id")
              .eq("company_id", auth.companyId)
              .eq("page_id", body.selected_page_id)
              .maybeSingle();

            const pagePayload = {
              company_id: auth.companyId,
              integration_id: integrationId,
              page_id: body.selected_page_id,
              page_name: body.selected_page_name ?? body.selected_page_id,
              ig_business_account_id: body.selected_instagram_id ?? null,
              ig_username: body.selected_instagram_username ?? null,
              page_access_token: body.access_token, // user token; refresh real fica para fase futura
              active: true,
              last_error: null,
            };
            if (pageExisting?.id) {
              await supabaseAdmin
                .from("meta_pages")
                .update(pagePayload)
                .eq("id", pageExisting.id);
            } else {
              await supabaseAdmin.from("meta_pages").insert(pagePayload);
            }
          } catch (e) {
            console.warn("META_ONBOARDING_SAVE_ERROR", { stage: "meta_pages_optional", e });
          }
        }

        return Response.json({
          ok: true,
          integration_id: integrationId,
          display_name: displayName,
          phone_number: phoneNumber,
          waba_id: body.selected_waba_id,
          page_id: body.selected_page_id ?? null,
          page_name: body.selected_page_name ?? null,
        });
      },
    },
  },
});
