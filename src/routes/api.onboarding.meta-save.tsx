// Endpoint isolado da Fase 3 do onboarding.
// Salva uma integração WhatsApp Cloud oficial (Meta) por empresa.
// NÃO altera meta-webhook, meta-send, integrações antigas nem Evolution.
// O access_token chega aqui via POST autenticado, é validado server-side,
// gravado em integrations.access_token (service role) e nunca devolvido ao cliente.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { validatePageAccessToken } from "@/lib/meta-page-token";

const GRAPH = "https://graph.facebook.com/v25.0";
const WABA_SUBSCRIBED_FIELDS = "messages,message_template_status_update";
const PAGE_SUBSCRIBED_FIELDS = "messages,messaging_postbacks,feed";

// Meta documenta long-lived user tokens com TTL de ~60 dias.
// Quando a resposta vier sem `expires_in`, assumimos esse padrão e logamos
// explicitamente — antes ficávamos com `token_expires_at = NULL` em silêncio.
const LONG_LIVED_DEFAULT_TTL_SECONDS = 60 * 24 * 60 * 60;

async function exchangeLongLivedToken(
  shortToken: string,
  attempt = 1,
): Promise<{
  access_token: string;
  expires_in: number;
  assumed_ttl: boolean;
} | null> {
  const appId = process.env.META_APP_ID ?? "";
  const appSecret = process.env.META_APP_SECRET ?? "";
  if (!appId || !appSecret) {
    console.warn("META_LONG_LIVED_SKIP_NO_SECRETS", { attempt });
    return null;
  }
  try {
    const url =
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token` +
      `&client_id=${encodeURIComponent(appId)}` +
      `&client_secret=${encodeURIComponent(appSecret)}` +
      `&fb_exchange_token=${encodeURIComponent(shortToken)}`;
    const r = await fetch(url);
    const body = (await r.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: { message?: string; code?: number };
    };
    if (!r.ok || !body.access_token) {
      console.warn("META_LONG_LIVED_FAIL", {
        attempt,
        status: r.status,
        error: body.error ?? null,
      });
      // Retry once em falha transitória (rede / 5xx).
      if (attempt < 2 && (r.status >= 500 || r.status === 0)) {
        console.warn("META_LONG_LIVED_RETRY", { attempt });
        return exchangeLongLivedToken(shortToken, attempt + 1);
      }
      return null;
    }
    const hasExpiresIn = typeof body.expires_in === "number" && body.expires_in > 0;
    if (!hasExpiresIn) {
      console.warn("META_LONG_LIVED_MISSING_EXPIRES_IN", {
        attempt,
        raw_expires_in: body.expires_in ?? null,
        assumed_ttl_seconds: LONG_LIVED_DEFAULT_TTL_SECONDS,
      });
    }
    const expiresIn = hasExpiresIn ? body.expires_in! : LONG_LIVED_DEFAULT_TTL_SECONDS;
    console.log("META_LONG_LIVED_OK", {
      attempt,
      expires_in: expiresIn,
      assumed_ttl: !hasExpiresIn,
    });
    return {
      access_token: body.access_token,
      expires_in: expiresIn,
      assumed_ttl: !hasExpiresIn,
    };
  } catch (e) {
    console.warn("META_LONG_LIVED_EXCEPTION", { attempt, e: String(e) });
    if (attempt < 2) {
      console.warn("META_LONG_LIVED_RETRY", { attempt, reason: "exception" });
      return exchangeLongLivedToken(shortToken, attempt + 1);
    }
    return null;
  }
}

async function subscribeWaba(wabaId: string, token: string) {
  try {
    const url = `${GRAPH}/${encodeURIComponent(wabaId)}/subscribed_apps`;
    const body = new URLSearchParams({
      subscribed_fields: WABA_SUBSCRIBED_FIELDS,
      access_token: token,
    });
    const r = await fetch(url, { method: "POST", body });
    const text = await r.text();
    console.log("META_WABA_SUBSCRIBED", {
      waba_id: wabaId,
      status: r.status,
      ok: r.ok,
      body: text.slice(0, 500),
    });
    return r.ok;
  } catch (e) {
    console.warn("META_WABA_SUBSCRIBE_EXCEPTION", { waba_id: wabaId, e: String(e) });
    return false;
  }
}

async function fetchPageDetails(pageId: string, userToken: string) {
  try {
    const url =
      `${GRAPH}/${encodeURIComponent(pageId)}?fields=name,access_token,instagram_business_account{id,username}` +
      `&access_token=${encodeURIComponent(userToken)}`;
    const r = await fetch(url);
    const j = (await r.json()) as {
      name?: string;
      access_token?: string;
      instagram_business_account?: { id?: string; username?: string };
      error?: { message?: string };
    };
    if (!r.ok || j.error) {
      console.warn("META_PAGE_TOKEN_FAIL", { page_id: pageId, status: r.status, error: j.error });
      return null;
    }
    return j;
  } catch (e) {
    console.warn("META_PAGE_TOKEN_EXCEPTION", { page_id: pageId, e: String(e) });
    return null;
  }
}

async function subscribePage(pageId: string, pageToken: string) {
  try {
    const url = `${GRAPH}/${encodeURIComponent(pageId)}/subscribed_apps`;
    const body = new URLSearchParams({
      subscribed_fields: PAGE_SUBSCRIBED_FIELDS,
      access_token: pageToken,
    });
    const r = await fetch(url, { method: "POST", body });
    const text = await r.text();
    console.log("META_PAGE_SUBSCRIBED_ONBOARDING", {
      page_id: pageId,
      status: r.status,
      ok: r.ok,
      body: text.slice(0, 500),
    });
    return r.ok;
  } catch (e) {
    console.warn("META_PAGE_SUBSCRIBE_EXCEPTION", { page_id: pageId, e: String(e) });
    return false;
  }
}

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

        // Valida token e enriquece dados do número direto da Meta.
        // Também lê whatsapp_business_account para travar mismatch entre
        // phone_number_id, token e WABA selecionada no popup.
        let phoneInfo: {
          display_phone_number?: string;
          verified_name?: string;
          real_waba_id?: string | null;
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
            `${GRAPH}/${encodeURIComponent(body.selected_phone_number_id)}?fields=display_phone_number,verified_name,whatsapp_business_account{id,name}&access_token=${tok}`,
          );
          const phJson = (await phRes.json()) as {
            display_phone_number?: string;
            verified_name?: string;
            whatsapp_business_account?: { id?: string; name?: string };
            error?: { message?: string; code?: number };
          };
          if (!phRes.ok || phJson.error) {
            console.error("META_ONBOARDING_PHONE_LOOKUP_FAILED", {
              status: phRes.status,
              error: phJson.error ?? null,
              phoneNumberId: body.selected_phone_number_id,
            });
            return Response.json(
              {
                error:
                  phJson.error?.message ??
                  "Não foi possível validar este número WhatsApp com o token informado. O token pode não ter permissão sobre ele.",
              },
              { status: 400 },
            );
          }
          const realWabaId = phJson.whatsapp_business_account?.id ?? null;
          phoneInfo = {
            display_phone_number: phJson.display_phone_number,
            verified_name: phJson.verified_name,
            real_waba_id: realWabaId,
          };
          console.log("META_ONBOARDING_PHONE_LOOKUP_OK", {
            phoneNumberId: body.selected_phone_number_id,
            hasDisplay: !!phJson.display_phone_number,
            hasVerifiedName: !!phJson.verified_name,
            selectedWabaId: body.selected_waba_id,
            realWabaId,
          });

          if (realWabaId && realWabaId !== body.selected_waba_id) {
            console.error("META_WABA_MISMATCH", {
              phoneNumberId: body.selected_phone_number_id,
              selectedWabaId: body.selected_waba_id,
              realWabaId,
            });
            return Response.json(
              {
                error:
                  `WABA inconsistente: o número ${body.selected_phone_number_id} pertence à WABA ${realWabaId}, ` +
                  `mas foi enviada ${body.selected_waba_id}. Reconecte selecionando a conta correta.`,
                code: "META_WABA_MISMATCH",
                real_waba_id: realWabaId,
                selected_waba_id: body.selected_waba_id,
              },
              { status: 400 },
            );
          }
        } catch (e) {
          console.error("META_ONBOARDING_SAVE_ERROR", { stage: "validate_token_exception", e });
          return Response.json({ error: "Falha ao validar token Meta" }, { status: 400 });
        }

        // Troca por long-lived user token (~60 dias). Se falhar, segue com short-lived
        // mas registra alerta — token curto expira em ~1-2h e quebra envio outbound.
        const longLived = await exchangeLongLivedToken(body.access_token);
        const effectiveToken = longLived?.access_token ?? body.access_token;
        const tokenExpiresAt = longLived?.expires_in
          ? new Date(Date.now() + longLived.expires_in * 1000).toISOString()
          : null;
        if (!longLived) {
          console.warn("META_LONG_LIVED_UNAVAILABLE", {
            companyId: auth.companyId,
            note: "Salvando short-lived token; expira em ~1-2h.",
          });
        }

        // Assina a WABA aos eventos do webhook (sem isto o número não recebe mensagens).
        const wabaSubscribed = await subscribeWaba(body.selected_waba_id, effectiveToken);

        const displayPhoneNumber =
          phoneInfo.display_phone_number ?? body.selected_phone_number ?? null;
        const phoneNumber = displayPhoneNumber;
        const verifiedName =
          phoneInfo.verified_name ?? body.selected_phone_verified_name ?? null;

        const displayName =
          verifiedName ?? phoneNumber ?? `WhatsApp ${body.selected_phone_number_id}`;

        const accountMetadata = {
          phone_number: phoneNumber,
          display_phone_number: displayPhoneNumber,
          verified_name: verifiedName,
          waba_id: body.selected_waba_id,
          page_id: body.selected_page_id ?? null,
          page_name: body.selected_page_name ?? null,
          business_id: body.selected_business_id ?? null,
          instagram_business_account_id: body.selected_instagram_id ?? null,
          instagram_username: body.selected_instagram_username ?? null,
          onboarded_via: "meta_whatsapp_cloud",
          onboarded_at: new Date().toISOString(),
          waba_subscribed: wabaSubscribed,
          waba_verified: phoneInfo.real_waba_id === body.selected_waba_id,
          verified_waba_id: phoneInfo.real_waba_id ?? null,
          long_lived_token: Boolean(longLived?.access_token),
        };

        // Upsert integration ISOLADO por company_id — nunca reutiliza linha de outra empresa.
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
        console.log("META_EXISTING_INTEGRATION_FOUND", {
          companyId: auth.companyId,
          phoneNumberId: body.selected_phone_number_id,
          existingId: existing?.id ?? null,
          willUpdate: !!existing?.id,
        });

        const integrationPayload = {
          company_id: auth.companyId,
          channel: "whatsapp" as const,
          display_name: displayName,
          active: true,
          external_account_id: body.selected_phone_number_id,
          account_metadata: accountMetadata,
          access_token: effectiveToken,
          token_expires_at: tokenExpiresAt,
          last_synced_at: new Date().toISOString(),
          last_error: wabaSubscribed ? null : "Webhook WABA não confirmado",
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

        // meta_pages: SOMENTE página explicitamente escolhida pelo usuário, isolada por company_id.
        let pageSubscribed: boolean | null = null;
        if (body.selected_page_id) {
          try {
            const details = await fetchPageDetails(body.selected_page_id, effectiveToken);
            const rawPageToken = details?.access_token ?? null;
            const pageName = details?.name ?? body.selected_page_name ?? body.selected_page_id;
            const igId =
              details?.instagram_business_account?.id ?? body.selected_instagram_id ?? null;
            const igUsername =
              details?.instagram_business_account?.username ??
              body.selected_instagram_username ??
              null;

            // Sanitiza + valida o page_access_token contra Graph /me ANTES de gravar.
            // Sem fallback para user token: a coluna page_access_token só deve
            // conter um page token válido, ou ficar com o último valor bom.
            const tokenCheck = await validatePageAccessToken(
              rawPageToken,
              body.selected_page_id,
            );
            const validPageToken = tokenCheck.ok ? tokenCheck.token : null;
            if (!tokenCheck.ok) {
              console.warn("META_PAGE_TOKEN_INVALID", {
                page_id: body.selected_page_id,
                reason: tokenCheck.reason,
                returned_page_id: tokenCheck.pageId ?? null,
              });
            }

            if (validPageToken) {
              pageSubscribed = await subscribePage(body.selected_page_id, validPageToken);
            } else {
              console.warn("META_PAGE_TOKEN_MISSING", { page_id: body.selected_page_id });
            }

            // Isola lookup por company_id — não sobrescreve linha de outra empresa.
            const { data: pageExisting } = await supabaseAdmin
              .from("meta_pages")
              .select("id, page_access_token")
              .eq("company_id", auth.companyId)
              .eq("page_id", body.selected_page_id)
              .maybeSingle();

            // Só grava page_access_token se for válido. Caso contrário,
            // mantém o valor anterior (não sobrescreve com user token / lixo).
            const last_error = !validPageToken
              ? `Page token inválido: ${tokenCheck.reason}`
              : pageSubscribed === false
                ? "Webhook Page não confirmado"
                : null;

            if (pageExisting?.id) {
              // Update: só inclui page_access_token se for válido (preserva o anterior).
              const updatePayload: Record<string, unknown> = {
                integration_id: integrationId,
                page_name: pageName,
                ig_business_account_id: igId,
                ig_username: igUsername,
                token_expires_at: tokenExpiresAt,
                active: true,
                last_error,
              };
              if (validPageToken) updatePayload.page_access_token = validPageToken;
              await supabaseAdmin
                .from("meta_pages")
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .update(updatePayload as any)
                .eq("id", pageExisting.id)
                .eq("company_id", auth.companyId);
            } else {
              await supabaseAdmin.from("meta_pages").insert({
                company_id: auth.companyId,
                integration_id: integrationId,
                page_id: body.selected_page_id,
                page_name: pageName,
                ig_business_account_id: igId,
                ig_username: igUsername,
                page_access_token: validPageToken ?? "",
                token_expires_at: tokenExpiresAt,
                active: true,
                last_error,
              });
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
          waba_subscribed: wabaSubscribed,
          page_subscribed: pageSubscribed,
        });
      },
    },
  },
});
