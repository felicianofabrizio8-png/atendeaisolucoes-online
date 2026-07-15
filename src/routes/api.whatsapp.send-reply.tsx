// Envia uma mensagem de texto via WhatsApp Cloud API citando (responder a)
// uma mensagem específica da mesma conversa. Feature 3 — Reply (V1).
//
// Escopo: NÃO altera send-message, send-media, send-audio, send-location,
// forward-message, webhook, templates ou IA. Apenas conversas channel='whatsapp'.
// Respeita janela de 24h. Persiste source_metadata.reply_to (sem migration).

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isWithin24hWindow } from "@/lib/wa-templates.server";
import { postGraph } from "@/lib/outbound/MetaOutbound.server";
import { isSimulation, isRealDelivery } from "@/lib/outbound/MetaOutboundContract";

interface SendReplyBody {
  conversationId?: string;
  text?: string;
  replyToMessageId?: string;
}

function shortError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return "erro desconhecido"; }
}

function buildPreview(original: { text: string | null; source_subtype: string | null }): string {
  const t = (original.text ?? "").trim();
  if (t) return t.replace(/\s+/g, " ").slice(0, 120);
  switch ((original.source_subtype ?? "").toLowerCase()) {
    case "image": return "📷 Foto";
    case "video": return "🎥 Vídeo";
    case "audio": return "🎤 Áudio";
    case "document": return "📎 Documento";
    case "sticker": return "🌟 Sticker";
    case "location": return "📍 Localização";
    default: return "[mensagem]";
  }
}

export const Route = createFileRoute("/api/whatsapp/send-reply")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // 1. Auth
        const authHeader = request.headers.get("authorization") ?? "";
        const accessToken = authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length)
          : "";
        if (!accessToken) {
          return Response.json({ error: "não autenticado" }, { status: 401 });
        }
        const { data: userRes, error: userErr } =
          await supabaseAdmin.auth.getUser(accessToken);
        if (userErr || !userRes.user) {
          return Response.json({ error: "sessão inválida" }, { status: 401 });
        }
        const userId = userRes.user.id;

        // 2. Input
        let body: SendReplyBody;
        try {
          body = (await request.json()) as SendReplyBody;
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }
        const conversationId = (body.conversationId ?? "").trim();
        const text = (body.text ?? "").trim();
        const replyToMessageId = (body.replyToMessageId ?? "").trim();
        if (!conversationId || !text || !replyToMessageId) {
          return Response.json(
            { error: "conversationId, text e replyToMessageId obrigatórios" },
            { status: 400 },
          );
        }
        if (text.length > 4096) {
          return Response.json({ error: "texto muito longo (máx 4096)" }, { status: 400 });
        }

        // 3. Empresa do operador
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("company_id")
          .eq("id", userId)
          .maybeSingle();
        if (!profile?.company_id) {
          return Response.json({ error: "perfil sem empresa" }, { status: 403 });
        }
        const companyId = profile.company_id;

        // 4. Conversa
        const { data: conv } = await supabaseAdmin
          .from("conversations")
          .select("id, company_id, channel, lead_id")
          .eq("id", conversationId)
          .maybeSingle();
        if (!conv || conv.company_id !== companyId) {
          return Response.json({ error: "conversa não encontrada" }, { status: 404 });
        }
        if (conv.channel !== "whatsapp") {
          return Response.json(
            { error: "Reply disponível apenas para WhatsApp" },
            { status: 400 },
          );
        }

        // 5. Mensagem original (deve pertencer à mesma conversa e ter external_id)
        const { data: original } = await supabaseAdmin
          .from("messages")
          .select("id, conversation_id, company_id, external_id, text, role, source_subtype")
          .eq("id", replyToMessageId)
          .maybeSingle();
        if (
          !original ||
          original.company_id !== companyId ||
          original.conversation_id !== conv.id
        ) {
          return Response.json(
            { error: "mensagem original não encontrada" },
            { status: 404 },
          );
        }
        if (!original.external_id) {
          return Response.json(
            { error: "mensagem original não possui identificador WhatsApp (não pode ser citada)" },
            { status: 400 },
          );
        }

        // 6. Lead destinatário
        const { data: lead } = await supabaseAdmin
          .from("leads")
          .select("id, phone, external_id, integration_id")
          .eq("id", conv.lead_id)
          .maybeSingle();
        const recipient = String(lead?.external_id ?? lead?.phone ?? "").replace(/\D/g, "");
        if (recipient.length < 8 || recipient.length > 15) {
          return Response.json({ error: "lead sem telefone válido" }, { status: 400 });
        }

        // 7. Janela 24h
        const win = await isWithin24hWindow(conv.id);
        if (!win.inside) {
          return Response.json(
            {
              error: "Destinatário fora da janela de 24h. Aguarde uma resposta do cliente ou use um template.",
              requires_template: true,
              last_lead_at: win.lastLeadAt,
            },
            { status: 409 },
          );
        }

        // 8. Integração
        const integrationQuery = supabaseAdmin
          .from("integrations")
          .select("id, access_token, external_account_id")
          .eq("company_id", companyId)
          .eq("channel", "whatsapp")
          .eq("active", true);
        const { data: integration } = lead?.integration_id
          ? await integrationQuery.eq("id", lead.integration_id).maybeSingle()
          : await integrationQuery.limit(1).maybeSingle();
        if (!integration?.access_token || !integration.external_account_id) {
          return Response.json(
            { error: "WhatsApp não conectado para esta empresa" },
            { status: 400 },
          );
        }

        // 9. Envio Graph API com context.message_id
        const apiUrl = `https://graph.facebook.com/v20.0/${integration.external_account_id}/messages`;
        const sentAt = new Date().toISOString();
        const payload = {
          messaging_product: "whatsapp",
          to: recipient,
          type: "text",
          context: { message_id: original.external_id },
          text: { body: text, preview_url: false },
        };

        let externalId: string | null = null;
        const outbound = await postGraph<{ messages?: Array<{ id: string }>; error?: { message?: string; code?: number } }>({
          companyId,
          userId,
          action: "whatsapp.send.reply",
          url: apiUrl,
          method: "POST",
          headers: {
            Authorization: `Bearer ${integration.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          logicalPayload: payload,
          extractExternalId: (j) =>
            (j as { messages?: Array<{ id: string }> })?.messages?.[0]?.id ?? null,
        });

        if (isSimulation(outbound)) {
          return Response.json({
            simulated: true,
            externalRequestSent: false,
            simulationId: outbound.simulationId,
            environment: outbound.environment,
            conversationId: conv.id,
          });
        }

        if (!isRealDelivery(outbound)) {
          if (!outbound.externalRequestSent) {
            return Response.json(
              { error: `Falha ao enviar: ${outbound.error}` },
              { status: 502 },
            );
          }
          const providerErr = outbound.providerError as { message?: string; code?: number } | null | undefined;
          const msg = providerErr?.message ?? outbound.error;
          await supabaseAdmin
            .from("integrations")
            .update({ last_error: msg })
            .eq("id", integration.id);
          return Response.json(
            { error: `WhatsApp: ${msg}`, metaError: providerErr ?? null, status: outbound.status },
            { status: 502 },
          );
        }

        externalId = outbound.externalId;


        // 10. Persistência com reply_to em source_metadata (sem migration)
        const preview = buildPreview({
          text: original.text,
          source_subtype: original.source_subtype,
        });
        const { data: inserted, error: insertErr } = await supabaseAdmin
          .from("messages")
          .insert({
            company_id: companyId,
            conversation_id: conv.id,
            role: "agent",
            text,
            at: sentAt,
            external_id: externalId,
            integration_id: integration.id,
            source_metadata: {
              reply_to: {
                message_id: original.id,
                external_id: original.external_id,
                role: original.role,
                type: original.source_subtype ?? "text",
                preview,
              },
            },
          })
          .select("id, conversation_id, at")
          .single();
        if (insertErr) {
          return Response.json(
            { error: `Falha ao salvar mensagem: ${shortError(insertErr)}` },
            { status: 500 },
          );
        }

        await supabaseAdmin
          .from("conversations")
          .update({ last_message_at: sentAt, awaiting_reply: false, unread: 0 })
          .eq("id", conv.id);

        await supabaseAdmin
          .from("integrations")
          .update({ last_synced_at: sentAt, last_error: null })
          .eq("id", integration.id);

        return Response.json({
          id: inserted.id,
          conversationId: conv.id,
          externalId,
          at: sentAt,
        });
      },
    },
  },
});
