// Webhook público do WhatsApp Cloud API (Meta).
// - GET: verificação de assinatura (hub.challenge)
// - POST: recebe mensagens; cria/atualiza lead, conversation e message
//
// Endpoint estável (use na Meta como callback URL):
//   https://project--<projectId>.lovable.app/api/public/whatsapp/webhook
//
// Cada integração tem seu próprio verify_token. O webhook tenta validar
// contra qualquer integração ativa que case com o token enviado.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createHmac, timingSafeEqual } from "crypto";

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");

        if (mode !== "subscribe" || !token || !challenge) {
          return new Response("Bad Request", { status: 400 });
        }

        const { data } = await supabaseAdmin
          .from("integrations")
          .select("id")
          .eq("channel", "whatsapp")
          .eq("verify_token", token)
          .eq("active", true)
          .limit(1)
          .maybeSingle();

        if (!data) {
          return new Response("Forbidden", { status: 403 });
        }

        return new Response(challenge, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      },

      POST: async ({ request }) => {
        const rawBody = await request.text();
        const signatureHeader =
          request.headers.get("x-hub-signature-256") ?? "";

        let payload: WhatsAppWebhookPayload;
        try {
          payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        if (payload.object !== "whatsapp_business_account") {
          // Ignora eventos de outros objetos
          return new Response("ok", { status: 200 });
        }

        try {
          for (const entry of payload.entry ?? []) {
            for (const change of entry.changes ?? []) {
              if (change.field !== "messages") continue;
              const value = change.value;
              const phoneNumberId = value.metadata?.phone_number_id;
              if (!phoneNumberId) continue;

              const { data: integration } = await supabaseAdmin
                .from("integrations")
                .select("id, company_id, webhook_secret, access_token")
                .eq("channel", "whatsapp")
                .eq("external_account_id", phoneNumberId)
                .eq("active", true)
                .maybeSingle();

              if (!integration) continue;

              // HMAC OBRIGATÓRIO. Sem segredo configurado ou assinatura
              // inválida → ignoramos o evento. Isso impede que terceiros que
              // conheçam o phone_number_id injetem leads/mensagens falsas.
              if (
                !integration.webhook_secret ||
                !verifySignature(rawBody, signatureHeader, integration.webhook_secret)
              ) {
                console.warn("WhatsApp webhook: HMAC ausente ou inválido", {
                  integrationId: integration.id,
                });
                continue;
              }

              await processMessages({
                integrationId: integration.id,
                companyId: integration.company_id,
                accessToken: integration.access_token ?? null,
                value,
              });
            }
          }
        } catch (e) {
          console.error("Erro processando webhook WhatsApp", e);
          // Mesmo em erro retornamos 200 para evitar reentregas em loop —
          // erros já foram registrados no log.
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});

// ---------- HMAC ----------
function verifySignature(body: string, header: string, secret: string): boolean {
  if (!header.startsWith("sha256=")) return false;
  const provided = header.slice("sha256=".length);
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// ---------- processamento ----------
async function processMessages(args: {
  integrationId: string;
  companyId: string;
  value: WhatsAppValue;
}) {
  const { integrationId, companyId, value } = args;
  const messages = value.messages ?? [];
  const contactsById = new Map<string, WhatsAppContact>();
  for (const c of value.contacts ?? []) contactsById.set(c.wa_id, c);

  for (const m of messages) {
    const waId = m.from;
    const contact = contactsById.get(waId);
    const leadName = contact?.profile?.name ?? waId;
    const at = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();
    const text = extractText(m);

    // 1) lead (procura por external_id+integration ou phone)
    let leadId = await findOrCreateLead({
      companyId,
      integrationId,
      waId,
      leadName,
    });

    // 2) conversation
    const conversationId = await findOrCreateConversation({
      companyId,
      leadId,
      lastMessageAt: at,
    });

    // 3) message (idempotente via external_id)
    await supabaseAdmin
      .from("messages")
      .upsert(
        {
          company_id: companyId,
          conversation_id: conversationId,
          role: "lead",
          text,
          at,
          external_id: m.id,
          integration_id: integrationId,
        },
        { onConflict: "integration_id,external_id", ignoreDuplicates: true },
      );

    // 4) atualiza conversa
    await supabaseAdmin
      .from("conversations")
      .update({
        last_message_at: at,
        awaiting_reply: true,
      })
      .eq("id", conversationId);
  }

  await supabaseAdmin
    .from("integrations")
    .update({ last_synced_at: new Date().toISOString(), last_error: null })
    .eq("id", integrationId);
}

function extractText(m: WhatsAppMessage): string {
  if (m.type === "text" && m.text?.body) return m.text.body;
  if (m.type === "button" && m.button?.text) return m.button.text;
  if (m.type === "interactive") {
    const i = m.interactive;
    if (i?.button_reply?.title) return i.button_reply.title;
    if (i?.list_reply?.title) return i.list_reply.title;
  }
  if (m.type === "image") return "[imagem]";
  if (m.type === "audio") return "[áudio]";
  if (m.type === "video") return "[vídeo]";
  if (m.type === "document") return "[documento]";
  if (m.type === "location") return "[localização]";
  return `[${m.type ?? "mensagem"}]`;
}

async function findOrCreateLead(args: {
  companyId: string;
  integrationId: string;
  waId: string;
  leadName: string;
}): Promise<string> {
  const { companyId, integrationId, waId, leadName } = args;

  const { data: existing } = await supabaseAdmin
    .from("leads")
    .select("id")
    .eq("company_id", companyId)
    .eq("integration_id", integrationId)
    .eq("external_id", waId)
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data: byPhone } = await supabaseAdmin
    .from("leads")
    .select("id")
    .eq("company_id", companyId)
    .eq("phone", waId)
    .limit(1)
    .maybeSingle();

  if (byPhone?.id) {
    await supabaseAdmin
      .from("leads")
      .update({ integration_id: integrationId, external_id: waId })
      .eq("id", byPhone.id);
    return byPhone.id;
  }

  const { data: created, error } = await supabaseAdmin
    .from("leads")
    .insert({
      company_id: companyId,
      integration_id: integrationId,
      external_id: waId,
      name: leadName,
      phone: waId,
      channel: "whatsapp",
      status: "novo",
      tags: [],
    })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

async function findOrCreateConversation(args: {
  companyId: string;
  leadId: string;
  lastMessageAt: string;
}): Promise<string> {
  const { companyId, leadId, lastMessageAt } = args;
  const { data: existing } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("company_id", companyId)
    .eq("lead_id", leadId)
    .eq("channel", "whatsapp")
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: created, error } = await supabaseAdmin
    .from("conversations")
    .insert({
      company_id: companyId,
      lead_id: leadId,
      channel: "whatsapp",
      last_message_at: lastMessageAt,
      unread: 1,
      awaiting_reply: true,
    })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

// ---------- tipos do payload ----------
interface WhatsAppWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      field: string;
      value: WhatsAppValue;
    }>;
  }>;
}

interface WhatsAppValue {
  messaging_product: "whatsapp";
  metadata: { display_phone_number?: string; phone_number_id?: string };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: unknown[];
}

interface WhatsAppContact {
  wa_id: string;
  profile?: { name?: string };
}

interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body: string };
  button?: { text: string; payload?: string };
  interactive?: {
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
}
