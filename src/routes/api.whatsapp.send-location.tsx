// Envia a localização cadastrada da empresa (company_settings.location) para
// a conversa WhatsApp atual, via Meta Graph API (type=location).
//
// Escopo (Feature 2 — Localização):
//  - Não altera send-message, send-media, send-audio, webhook, IA, templates.
//  - Apenas conversas channel='whatsapp'.
//  - Respeita a janela de 24h (mesma regra do encaminhamento).
//  - Persiste a mensagem com source_subtype='location' e source_metadata
//    contendo { latitude, longitude, name, address, wa_message_id }.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isWithin24hWindow } from "@/lib/wa-templates.server";
import { postGraph } from "@/lib/outbound/MetaOutbound.server";
import { isSimulation, isRealDelivery } from "@/lib/outbound/MetaOutboundContract";

interface SendLocationBody {
  conversationId?: string;
}

interface LocationSettings {
  name?: string;
  address?: string;
  latitude?: number | string;
  longitude?: number | string;
}

function shortError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return "erro desconhecido"; }
}

export const Route = createFileRoute("/api/whatsapp/send-location")({
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
        let body: SendLocationBody;
        try {
          body = (await request.json()) as SendLocationBody;
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }
        const conversationId = (body.conversationId ?? "").trim();
        if (!conversationId) {
          return Response.json({ error: "conversationId obrigatório" }, { status: 400 });
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

        // 4. Conversa de destino
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
            { error: "envio de localização disponível apenas para WhatsApp" },
            { status: 400 },
          );
        }

        // 5. Localização salva
        const { data: settings } = await supabaseAdmin
          .from("company_settings")
          .select("location")
          .eq("company_id", companyId)
          .maybeSingle();
        const loc = (settings?.location ?? null) as LocationSettings | null;
        const lat = loc?.latitude != null ? Number(loc.latitude) : NaN;
        const lng = loc?.longitude != null ? Number(loc.longitude) : NaN;
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          return Response.json(
            { error: "Localização não configurada. Cadastre em Configurações > Localização da empresa." },
            { status: 400 },
          );
        }
        const name = (loc?.name ?? "").toString().trim().slice(0, 1000) || null;
        const address = (loc?.address ?? "").toString().trim().slice(0, 1000) || null;

        // 6. Lead destinatário (telefone)
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

        // 8. Integração WhatsApp
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

        // 9. Envio Graph API
        const apiUrl = `https://graph.facebook.com/v20.0/${integration.external_account_id}/messages`;
        const sentAt = new Date().toISOString();
        const locationPayload: Record<string, unknown> = {
          latitude: lat,
          longitude: lng,
        };
        if (name) locationPayload.name = name;
        if (address) locationPayload.address = address;
        const payload = {
          messaging_product: "whatsapp",
          to: recipient,
          type: "location",
          location: locationPayload,
        };

        let externalId: string | null = null;
        const outbound = await postGraph<{ messages?: Array<{ id: string }>; error?: { message?: string } }>({
          companyId,
          userId,
          action: "whatsapp.send.location",
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
          const providerErr = outbound.providerError as { message?: string } | null | undefined;
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


        // 10. Persistência
        const messageText = `📍 Localização${name ? `: ${name}` : ""}${address ? ` — ${address}` : ""}`;
        const { data: inserted, error: insertErr } = await supabaseAdmin
          .from("messages")
          .insert({
            company_id: companyId,
            conversation_id: conv.id,
            role: "agent",
            text: messageText,
            at: sentAt,
            external_id: externalId,
            integration_id: integration.id,
            source_subtype: "location",
            source_metadata: {
              latitude: lat,
              longitude: lng,
              name,
              address,
              wa_message_id: externalId,
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
