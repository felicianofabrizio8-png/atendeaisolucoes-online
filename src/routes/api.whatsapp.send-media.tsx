// Envia uma mídia (foto ou vídeo) via WhatsApp Cloud API.
// Aceita um path dentro do bucket privado `product-images` OU uma URL pública/assinada.
// Gera signed URL temporária para a Meta consumir, valida HEAD, dispara e persiste
// a mensagem em `messages` com source_metadata.media_url + type.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isWithin24hWindow } from "@/lib/wa-templates.server";

type MediaKind = "image" | "video";

interface SendMediaBody {
  conversationId?: string;
  mediaPath?: string; // path dentro do bucket product-images
  mediaUrl?: string; // ou URL externa já pública
  kind?: MediaKind;
  caption?: string;
}

const BUCKET = "product-images";

function pathFromUrl(url: string): string | null {
  const pub = "/object/public/product-images/";
  const sgn = "/object/sign/product-images/";
  if (url.includes(pub)) return decodeURIComponent(url.split(pub)[1] ?? "");
  if (url.includes(sgn)) return decodeURIComponent((url.split(sgn)[1] ?? "").split("?")[0]);
  return null;
}

export const Route = createFileRoute("/api/whatsapp/send-media")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const accessToken = authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length)
          : "";
        if (!accessToken) return Response.json({ error: "não autenticado" }, { status: 401 });

        const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
        if (userErr || !userRes.user) {
          return Response.json({ error: "sessão inválida" }, { status: 401 });
        }
        const userId = userRes.user.id;

        let body: SendMediaBody;
        try {
          body = (await request.json()) as SendMediaBody;
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }
        const conversationId = body.conversationId;
        const kind = body.kind === "video" ? "video" : "image";
        const caption = (body.caption ?? "").trim().slice(0, 1024);
        if (!conversationId) {
          return Response.json({ error: "conversationId obrigatório" }, { status: 400 });
        }
        if (!body.mediaPath && !body.mediaUrl) {
          return Response.json({ error: "mediaPath ou mediaUrl obrigatório" }, { status: 400 });
        }

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userId)
          .maybeSingle();
        if (!profile?.company_id) {
          return Response.json({ error: "perfil sem empresa" }, { status: 403 });
        }
        const companyId = profile.company_id;

        // Conversa válida + empresa
        const { data: conv } = await supabaseAdmin
          .from("conversations")
          .select("id, company_id, lead_id, channel")
          .eq("id", conversationId)
          .maybeSingle();
        if (!conv || conv.company_id !== companyId) {
          return Response.json({ error: "conversa não encontrada" }, { status: 404 });
        }
        if (conv.channel !== "whatsapp") {
          return Response.json({ error: "conversa não é WhatsApp" }, { status: 400 });
        }

        // 24h window
        const win = await isWithin24hWindow(conversationId);
        if (!win.inside) {
          return Response.json(
            {
              error: "Cliente fora da janela de 24h. Use um template aprovado.",
              requires_template: true,
              last_lead_at: win.lastLeadAt,
            },
            { status: 409 },
          );
        }

        const { data: lead } = await supabaseAdmin
          .from("leads")
          .select("id, phone, external_id, integration_id, company_id")
          .eq("id", conv.lead_id)
          .maybeSingle();
        if (!lead || lead.company_id !== companyId) {
          return Response.json({ error: "lead não encontrado" }, { status: 404 });
        }
        const recipient = String(lead.external_id ?? lead.phone ?? "").replace(/\D/g, "");
        if (recipient.length < 8 || recipient.length > 15) {
          return Response.json({ error: "lead sem telefone válido" }, { status: 400 });
        }

        const integrationQuery = supabaseAdmin
          .from("integrations")
          .select("id, access_token, external_account_id")
          .eq("company_id", companyId)
          .eq("channel", "whatsapp")
          .eq("active", true);
        const { data: integration } = lead.integration_id
          ? await integrationQuery.eq("id", lead.integration_id).maybeSingle()
          : await integrationQuery.limit(1).maybeSingle();
        if (!integration?.access_token || !integration.external_account_id) {
          return Response.json(
            { error: "WhatsApp não conectado para esta empresa" },
            { status: 400 },
          );
        }

        // Resolve path/URL → signed URL. A biblioteca de produtos pode enviar
        // uma URL pública/assinada antiga; nesses casos extraímos o path real.
        const incomingRef = (body.mediaPath ?? body.mediaUrl ?? "").trim();
        const isHttpRef = /^https?:\/\//i.test(incomingRef);
        const resolvedPath = isHttpRef
          ? pathFromUrl(incomingRef)
          : incomingRef.replace(/^\/+/, "");
        let publicLink: string;
        let storedRef: string; // o que salvamos no source_metadata
        if (resolvedPath) {
          // Segurança multi-tenant: paths novos precisam começar por company_id.
          // Paths legados da biblioteca, gravados na raiz do bucket antes do
          // escopo por empresa, continuam válidos para não bloquear produtos já cadastrados.
          const isCompanyScopedPath = resolvedPath.startsWith(`${companyId}/`);
          const isLegacyRootPath = !resolvedPath.includes("/");
          if (!isCompanyScopedPath && !isLegacyRootPath) {
            return Response.json(
              { error: "Mídia fora desta empresa" },
              { status: 403 },
            );
          }
          const { data: signed, error: signErr } = await supabaseAdmin.storage
            .from(BUCKET)
            .createSignedUrl(resolvedPath, 60 * 60);
          if (signErr || !signed?.signedUrl) {
            console.error("[send-media] sign error", signErr);
            return Response.json(
              { error: `Falha ao preparar mídia: ${signErr?.message ?? "sign"}` },
              { status: 500 },
            );
          }
          publicLink = signed.signedUrl;
          storedRef = resolvedPath; // salvamos o path, signed URL é gerada na exibição
        } else if (isHttpRef) {
          publicLink = incomingRef;
          storedRef = incomingRef;
        } else {
          return Response.json({ error: "Referência de mídia inválida" }, { status: 400 });
        }

        // Valida acessibilidade. Alguns provedores aceitam GET assinado, mas
        // respondem mal a HEAD; por isso tentamos HEAD e depois GET parcial.
        try {
          const h = await fetch(publicLink, { method: "HEAD" });
          if (!h.ok) {
            const g = await fetch(publicLink, { method: "GET", headers: { Range: "bytes=0-0" } });
            if (!g.ok && g.status !== 206) {
              return Response.json(
                { error: `Mídia inacessível (HTTP ${h.status}/${g.status}).` },
                { status: 400 },
              );
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "erro de rede";
          return Response.json({ error: `Falha ao validar mídia: ${msg}` }, { status: 400 });
        }

        const apiUrl = `https://graph.facebook.com/v20.0/${integration.external_account_id}/messages`;
        const sentAt = new Date().toISOString();
        const payload: Record<string, unknown> = {
          messaging_product: "whatsapp",
          to: recipient,
          type: kind,
          [kind]: caption ? { link: publicLink, caption } : { link: publicLink },
        };

        let externalId: string | null = null;
        try {
          const apiRes = await fetch(apiUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${integration.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });
          const apiText = await apiRes.text();
          let apiJson: {
            messages?: Array<{ id: string }>;
            error?: { message?: string; code?: number };
          } = {};
          try {
            apiJson = JSON.parse(apiText);
          } catch {
            /* */
          }
          if (!apiRes.ok) {
            const msg = apiJson.error?.message ?? `HTTP ${apiRes.status}`;
            console.error("[send-media] meta error", { status: apiRes.status, body: apiText.slice(0, 800) });
            await supabaseAdmin
              .from("integrations")
              .update({ last_error: msg })
              .eq("id", integration.id);
            return Response.json(
              { error: `WhatsApp: ${msg}`, metaError: apiJson.error ?? null, status: apiRes.status },
              { status: 502 },
            );
          }
          externalId = apiJson.messages?.[0]?.id ?? null;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "falha de rede";
          return Response.json({ error: `Falha ao enviar: ${msg}` }, { status: 502 });
        }

        const messageText = caption || `[${kind === "video" ? "vídeo" : "imagem"}]`;
        const { data: inserted, error: insertErr } = await supabaseAdmin
          .from("messages")
          .insert({
            company_id: companyId,
            conversation_id: conversationId,
            role: "agent",
            text: messageText,
            at: sentAt,
            external_id: externalId,
            integration_id: integration.id,
            source_subtype: kind,
            source_metadata: {
              media_url: storedRef,
              type: kind,
              caption: caption || null,
            },
          })
          .select("id, conversation_id, role, text, at")
          .single();
        if (insertErr) {
          console.error("[send-media] insert error", insertErr);
          return Response.json({ error: "Falha ao salvar mensagem" }, { status: 500 });
        }

        await supabaseAdmin
          .from("conversations")
          .update({ last_message_at: sentAt, awaiting_reply: false, unread: 0 })
          .eq("id", conversationId);

        await supabaseAdmin
          .from("integrations")
          .update({ last_synced_at: sentAt, last_error: null })
          .eq("id", integration.id);

        return Response.json({
          id: inserted.id,
          conversationId,
          externalId,
          at: sentAt,
          kind,
        });
      },
    },
  },
});
