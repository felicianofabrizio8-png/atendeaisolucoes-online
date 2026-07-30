// Endpoints autenticados para gerenciar integrações WhatsApp.
// Tokens NUNCA trafegam para o cliente — só são gravados aqui via service role.
// O cliente sempre lê pela view `integrations_safe`.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { appendOnboardingEvent } from "@/lib/onboarding/appendEvent.server";
import { sanitizeForLog, safeErrorMessage } from "@/lib/audit/sanitize";

interface UpsertBody {
  displayName: string;
  phoneNumberId: string;
  phoneNumber?: string;
  wabaId?: string;
  accessToken: string;
  verifyToken: string;
  webhookSecret?: string;
}

interface ToggleBody {
  id: string;
  active: boolean;
}

interface DeleteBody {
  id: string;
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

export const Route = createFileRoute("/api/whatsapp/integration")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticate(request);
        if ("error" in auth) return auth.error;

        let body: UpsertBody;
        try {
          body = (await request.json()) as UpsertBody;
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }

        if (
          !body.displayName?.trim() ||
          !body.phoneNumberId?.trim() ||
          !body.accessToken?.trim() ||
          !body.verifyToken?.trim() ||
          !body.webhookSecret?.trim()
        ) {
          return Response.json(
            {
              error:
                "campos obrigatórios: displayName, phoneNumberId, accessToken, verifyToken, webhookSecret",
            },
            { status: 400 },
          );
        }
        // O webhook secret deve ter entropia mínima — Meta envia HMAC SHA-256
        // baseado nele, então um valor curto seria trivial de forjar.
        if (body.webhookSecret.trim().length < 16) {
          return Response.json(
            { error: "webhookSecret deve ter pelo menos 16 caracteres" },
            { status: 400 },
          );
        }

        const payload = {
          company_id: auth.companyId,
          channel: "whatsapp" as const,
          display_name: body.displayName,
          active: true,
          external_account_id: body.phoneNumberId,
          account_metadata: {
            phone_number: body.phoneNumber ?? null,
            waba_id: body.wabaId ?? null,
          },
          access_token: body.accessToken,
          verify_token: body.verifyToken,
          webhook_secret: body.webhookSecret,
        };
        console.log("[whatsapp integration save] payload", {
          companyId: auth.companyId,
          channel: payload.channel,
          displayName: payload.display_name,
          phoneNumberId: payload.external_account_id,
          accountMetadata: sanitizeForLog(payload.account_metadata),
          hasAccessToken: !!payload.access_token,
          hasVerifyToken: !!payload.verify_token,
          hasWebhookSecret: !!payload.webhook_secret,
        });

        const { data: existing, error: existingError } = await supabaseAdmin
          .from("integrations")
          .select("id")
          .eq("company_id", auth.companyId)
          .eq("channel", "whatsapp")
          .eq("external_account_id", body.phoneNumberId)
          .maybeSingle();
        if (existingError) {
          console.error("[whatsapp integration save] lookup error", safeErrorMessage(existingError.message));
          // `details` expunha o objeto cru do Postgres ao cliente.
          return Response.json({ error: "Falha ao consultar integração." }, { status: 500 });
        }

        const safeCols =
          "id, company_id, channel, display_name, active, external_account_id, account_metadata, last_synced_at, last_error, created_at, updated_at";

        if (existing?.id) {
          const { data: updated, error } = await supabaseAdmin
            .from("integrations")
            .update(payload)
            .eq("id", existing.id)
            .select(safeCols)
            .single();
          if (error || !updated) {
            console.error("integrations update error", safeErrorMessage(error?.message));
            return Response.json({ error: "Falha ao atualizar integração." }, { status: 500 });
          }
          console.log("integrations updated", { id: updated.id, company_id: updated.company_id });
          await appendOnboardingEvent(auth.companyId, "whatsapp_connected", { updated: true });
          return Response.json({
            id: updated.id,
            updated: true,
            row: { ...updated, has_access_token: true, has_webhook_secret: true },
          });
        }

        const { data, error } = await supabaseAdmin
          .from("integrations")
          .insert(payload)
          .select(safeCols)
          .single();
        if (error || !data) {
          console.error("integrations insert error", safeErrorMessage(error?.message));
          return Response.json({ error: "Falha ao criar integração." }, { status: 500 });
        }
        console.log("integrations inserted", { id: data.id, company_id: data.company_id });
        await appendOnboardingEvent(auth.companyId, "whatsapp_connected", { created: true });
        return Response.json({
          id: data.id,
          created: true,
          row: { ...data, has_access_token: true, has_webhook_secret: true },
        });
      },

      PATCH: async ({ request }) => {
        const auth = await authenticate(request);
        if ("error" in auth) return auth.error;

        let body: ToggleBody;
        try {
          body = (await request.json()) as ToggleBody;
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }
        if (!body.id || typeof body.active !== "boolean") {
          return Response.json({ error: "id e active obrigatórios" }, { status: 400 });
        }
        // garante que pertence à empresa
        const { data: row } = await supabaseAdmin
          .from("integrations")
          .select("id, company_id")
          .eq("id", body.id)
          .maybeSingle();
        if (!row || row.company_id !== auth.companyId) {
          return Response.json({ error: "integração não encontrada" }, { status: 404 });
        }
        const { error } = await supabaseAdmin
          .from("integrations")
          .update({ active: body.active })
          .eq("id", body.id);
        if (error) {
          console.error("integrations patch error", safeErrorMessage(error.message));
          return Response.json({ error: "Operação falhou. Tente novamente." }, { status: 500 });
        }
        return Response.json({ ok: true });
      },

      DELETE: async ({ request }) => {
        const auth = await authenticate(request);
        if ("error" in auth) return auth.error;

        let body: DeleteBody;
        try {
          body = (await request.json()) as DeleteBody;
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }
        if (!body.id) {
          return Response.json({ error: "id obrigatório" }, { status: 400 });
        }
        const { data: row } = await supabaseAdmin
          .from("integrations")
          .select("id, company_id")
          .eq("id", body.id)
          .maybeSingle();
        if (!row || row.company_id !== auth.companyId) {
          return Response.json({ error: "integração não encontrada" }, { status: 404 });
        }
        const { error } = await supabaseAdmin
          .from("integrations")
          .delete()
          .eq("id", body.id);
        if (error) {
          console.error("integrations delete error", safeErrorMessage(error.message));
          return Response.json({ error: "Operação falhou. Tente novamente." }, { status: 500 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
