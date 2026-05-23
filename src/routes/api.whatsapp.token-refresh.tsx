// Renovar / validar manualmente o token da WhatsApp Cloud API.
//
// POST  → recebe { integrationId, accessToken, expiresAt? } e salva o novo
//          token (validando primeiro contra a Graph API).
// PUT   → recebe { integrationId } e revalida o token atualmente armazenado,
//          atualizando last_error / last_synced_at conforme o resultado.
//
// O endpoint NUNCA devolve o token completo — só o prefixo para diagnóstico.
// Tokens permanentes do tipo System User não têm expiração; nesse caso
// gravamos token_expires_at = NULL e marcamos isPermanent: true. A arquitetura
// é compatível: o resto da integração (webhook, envio, recebimento) continua
// igual quando o token permanente chegar.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

interface PostBody {
  integrationId: string;
  accessToken: string;
  expiresAt?: string | null; // ISO date
}
interface PutBody {
  integrationId: string;
}

async function authenticate(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const accessToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
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

// Valida um token contra a Graph API chamando /{phone_number_id}?fields=id.
// Retorna { ok, status, body, isAuthError, metaError }.
async function validateAgainstMeta(token: string, phoneNumberId: string) {
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}?fields=id,display_phone_number`;
  let status = 0;
  let raw = "";
  let json: unknown = null;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    status = res.status;
    raw = await res.text();
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: null,
      isAuthError: false,
      metaError: e instanceof Error ? e.message : "network error",
    };
  }
  const metaError = (json as {
    error?: { message?: string; code?: number; type?: string };
  })?.error;
  const isAuthError =
    status === 401 ||
    metaError?.type === "OAuthException" ||
    metaError?.code === 190 ||
    metaError?.code === 102;
  return {
    ok: status >= 200 && status < 300,
    status,
    body: json ?? raw,
    isAuthError,
    metaError: metaError?.message,
  };
}

export const Route = createFileRoute("/api/whatsapp/token-refresh")({
  server: {
    handlers: {
      // Salva um novo token (renovação manual)
      POST: async ({ request }) => {
        const auth = await authenticate(request);
        if ("error" in auth) return auth.error;

        let body: PostBody;
        try {
          body = (await request.json()) as PostBody;
        } catch {
          return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
        }
        const integrationId = String(body.integrationId ?? "").trim();
        const newToken = String(body.accessToken ?? "").trim();
        if (!integrationId || !newToken) {
          return Response.json(
            { ok: false, error: "integrationId e accessToken são obrigatórios" },
            { status: 400 },
          );
        }

        const { data: integration } = await supabaseAdmin
          .from("integrations")
          .select("id, company_id, channel, external_account_id")
          .eq("id", integrationId)
          .maybeSingle();
        if (
          !integration ||
          integration.company_id !== auth.companyId ||
          integration.channel !== "whatsapp"
        ) {
          return Response.json(
            { ok: false, error: "integração não encontrada" },
            { status: 404 },
          );
        }
        const phoneNumberId = integration.external_account_id ?? "";
        if (!phoneNumberId) {
          return Response.json(
            { ok: false, error: "integração sem phone_number_id" },
            { status: 400 },
          );
        }

        const check = await validateAgainstMeta(newToken, phoneNumberId);
        console.log("[whatsapp token-refresh POST] validation", {
          integrationId,
          phoneNumberId,
          tokenPrefix: newToken.slice(0, 6),
          status: check.status,
          ok: check.ok,
        });

        if (!check.ok) {
          const friendly = check.isAuthError
            ? "Token inválido ou expirado. Gere um novo no Meta Business e cole aqui."
            : check.metaError ?? `HTTP ${check.status}`;
          return Response.json(
            {
              ok: false,
              error: friendly,
              metaResponse: check.body,
            },
            { status: 400 },
          );
        }

        // Token válido → grava. Se expiresAt não veio, marcamos como
        // potencialmente permanente (NULL) — usuário pode preencher manualmente.
        const expiresAt = body.expiresAt && body.expiresAt.trim() ? body.expiresAt : null;
        const now = new Date().toISOString();
        const { error: upErr } = await supabaseAdmin
          .from("integrations")
          .update({
            access_token: newToken,
            token_expires_at: expiresAt,
            last_synced_at: now,
            last_error: null,
          })
          .eq("id", integrationId);
        if (upErr) {
          console.error("[whatsapp token-refresh POST] update failed", upErr);
          return Response.json(
            { ok: false, error: "Falha ao salvar token" },
            { status: 500 },
          );
        }
        return Response.json({
          ok: true,
          validatedAt: now,
          expiresAt,
          isPermanent: !expiresAt,
          metaResponse: check.body,
        });
      },

      // Revalida o token atualmente salvo
      PUT: async ({ request }) => {
        const auth = await authenticate(request);
        if ("error" in auth) return auth.error;
        let body: PutBody;
        try {
          body = (await request.json()) as PutBody;
        } catch {
          return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
        }
        const integrationId = String(body.integrationId ?? "").trim();
        if (!integrationId) {
          return Response.json(
            { ok: false, error: "integrationId obrigatório" },
            { status: 400 },
          );
        }
        const { data: integration } = await supabaseAdmin
          .from("integrations")
          .select("id, company_id, channel, access_token, external_account_id, token_expires_at")
          .eq("id", integrationId)
          .maybeSingle();
        if (
          !integration ||
          integration.company_id !== auth.companyId ||
          integration.channel !== "whatsapp"
        ) {
          return Response.json(
            { ok: false, error: "integração não encontrada" },
            { status: 404 },
          );
        }
        if (!integration.access_token || !integration.external_account_id) {
          return Response.json(
            { ok: false, error: "integração sem token ou phone_number_id" },
            { status: 400 },
          );
        }
        const check = await validateAgainstMeta(
          integration.access_token,
          integration.external_account_id,
        );
        const now = new Date().toISOString();
        console.log("[whatsapp token-refresh PUT] revalidation", {
          integrationId,
          status: check.status,
          ok: check.ok,
        });
        if (check.ok) {
          await supabaseAdmin
            .from("integrations")
            .update({ last_synced_at: now, last_error: null })
            .eq("id", integrationId);
          return Response.json({
            ok: true,
            validatedAt: now,
            expiresAt: integration.token_expires_at,
            isPermanent: !integration.token_expires_at,
            metaResponse: check.body,
          });
        }
        const friendly = check.isAuthError
          ? "Token expirado ou inválido. Renove o token na Meta e cole o novo aqui."
          : check.metaError ?? `HTTP ${check.status}`;
        await supabaseAdmin
          .from("integrations")
          .update({ last_error: `token: ${friendly}` })
          .eq("id", integrationId);
        return Response.json({
          ok: false,
          error: friendly,
          metaResponse: check.body,
        });
      },
    },
  },
});
