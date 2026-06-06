// Envia áudio (voice note) via WhatsApp Cloud API.
// Recebe multipart com `file` (Blob de áudio gravado no navegador),
// faz upload privado em `whatsapp-media/{companyId}/agent/...`, gera signed URL
// e dispara para a Meta como `audio: { link }`. Persiste em messages com
// source_subtype=audio e metadados padronizados para o renderer existente.
//
// Segurança: valida sessão, escopo de empresa, janela de 24h, integração ativa.
// Token da Meta nunca é exposto ao cliente.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isWithin24hWindow } from "@/lib/wa-templates.server";

const BUCKET = "whatsapp-media";
const MAX_BYTES = 16 * 1024 * 1024; // WhatsApp Cloud API: audio até 16MB
// WhatsApp Cloud API só aceita estes containers para áudio/voz.
// audio/webm é REJEITADO pela Meta (vira anexo no melhor caso) — bloqueamos
// antes mesmo de subir o arquivo, o cliente já grava em ogg/opus ou mp4/aac.
const ALLOWED_MIMES = new Set([
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/aac",
  "audio/mpeg",
  "audio/amr",
]);
const FRIENDLY_SEND_ERROR = "Áudio não enviado pelo WhatsApp. Grave novamente ou envie uma mensagem de texto.";
const GRAPH_VERSION = "v20.0";

type MetaAudioResponse = {
  messages?: Array<{ id?: string }>;
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
    error_data?: unknown;
    type?: string;
  };
};

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.startsWith("audio/ogg")) return "ogg";
  if (m.startsWith("audio/mp4")) return "m4a";
  if (m.startsWith("audio/aac")) return "aac";
  if (m.startsWith("audio/mpeg")) return "mp3";
  if (m.startsWith("audio/amr")) return "amr";
  return "bin";
}

function isAllowedMimeHeader(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().split(";")[0].trim();
  return ALLOWED_MIMES.has(value.toLowerCase()) || ALLOWED_MIMES.has(normalized);
}

function safeTokenDebug(token: string): { present: boolean; length: number } {
  return { present: token.length > 0, length: token.length };
}

export const Route = createFileRoute("/api/whatsapp/send-audio")({
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

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return Response.json({ error: "multipart inválido" }, { status: 400 });
        }
        const file = form.get("file");
        const conversationId = String(form.get("conversationId") ?? "");
        const durationRaw = form.get("duration");
        const duration = durationRaw ? Number(durationRaw) : null;
        if (!conversationId) {
          return Response.json({ error: "conversationId obrigatório" }, { status: 400 });
        }
        if (!(file instanceof Blob) || file.size === 0) {
          return Response.json({ error: "arquivo de áudio obrigatório" }, { status: 400 });
        }
        if (file.size > MAX_BYTES) {
          return Response.json({ error: "áudio maior que 16MB" }, { status: 413 });
        }
        const incomingMime = (file.type || "audio/ogg").toLowerCase();
        const baseMime = incomingMime.split(";")[0];
        if (!ALLOWED_MIMES.has(incomingMime) && !ALLOWED_MIMES.has(baseMime)) {
          return Response.json(
            { error: `Formato de áudio não suportado: ${incomingMime}` },
            { status: 415 },
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
        const companyId = profile.company_id;

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

        // Upload em whatsapp-media (privado), escopado por company_id.
        const ext = extFromMime(baseMime);
        const ts = Date.now();
        const rand = Math.random().toString(36).slice(2, 8);
        const storagePath = `${companyId}/agent/${ts}-${rand}.${ext}`;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { error: uploadErr } = await supabaseAdmin.storage
          .from(BUCKET)
          .upload(storagePath, bytes, { contentType: baseMime, upsert: false });
        if (uploadErr) {
          console.error("[send-audio] upload error", uploadErr);
          return Response.json(
            { error: `Falha ao salvar áudio: ${uploadErr.message}` },
            { status: 500 },
          );
        }

        const { data: signed, error: signErr } = await supabaseAdmin.storage
          .from(BUCKET)
          .createSignedUrl(storagePath, 60 * 60);
        if (signErr || !signed?.signedUrl) {
          console.error("[send-audio] sign error", signErr);
          await supabaseAdmin.storage.from(BUCKET).remove([storagePath]).then(() => null, () => null);
          return Response.json(
            { error: `Falha ao preparar áudio: ${signErr?.message ?? "sign"}` },
            { status: 500 },
          );
        }

        // Pré-flight: confirma que a signed URL está publicamente acessível pela Meta.
        let signedUrlStatus: number | string = "unknown";
        let signedUrlContentType: string | null = null;
        let signedUrlContentLength: string | null = null;
        let signedUrlIsValid = false;
        try {
          const preflight = await fetch(signed.signedUrl, { method: "GET" });
          signedUrlStatus = preflight.status;
          signedUrlContentType = preflight.headers.get("content-type");
          signedUrlContentLength = preflight.headers.get("content-length");
          const signedUrlLength = Number(signedUrlContentLength ?? 0);
          signedUrlIsValid =
            preflight.status === 200 &&
            Number.isFinite(signedUrlLength) &&
            signedUrlLength > 0 &&
            isAllowedMimeHeader(signedUrlContentType);
          console.log("[AUDIO FILE TEST]", {
            status: signedUrlStatus,
            content_type: signedUrlContentType,
            content_length: signedUrlContentLength,
            valid: signedUrlIsValid,
            expected: {
              status: 200,
              content_length_gt_zero: true,
              allowed_content_types: Array.from(ALLOWED_MIMES),
            },
            media_mime: baseMime,
            media_size: file.size,
          });
          if (preflight.status !== 200) {
            throw new Error(`signed url HTTP ${preflight.status}`);
          }
          if (!Number.isFinite(signedUrlLength) || signedUrlLength <= 0) {
            throw new Error("signed url sem content-length válido");
          }
          if (!isAllowedMimeHeader(signedUrlContentType)) {
            throw new Error(`signed url content-type inválido: ${signedUrlContentType ?? "ausente"}`);
          }
          // descarta body
          try { await preflight.body?.cancel(); } catch { /* */ }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "signed url inacessível";
          console.error("[AUDIO FILE TEST]", {
            valid: false,
            msg,
            signed_url_status: signedUrlStatus,
            signed_url_content_type: signedUrlContentType,
            signed_url_content_length: signedUrlContentLength,
            phone_number_id: integration.external_account_id,
            to: recipient,
            media_mime: baseMime,
            media_size: file.size,
          });
          await supabaseAdmin.from("error_log").insert({
            company_id: companyId,
            user_id: userId,
            source: "whatsapp.send-audio",
            severity: "error",
            message: `signed url preflight: ${msg}`,
            context: {
              conversation_id: conversationId,
              lead_phone: recipient,
              phone_number_id: integration.external_account_id,
              media_mime: baseMime,
              media_size: file.size,
              signed_url_status: signedUrlStatus,
              signed_url_content_type: signedUrlContentType,
              signed_url_content_length: signedUrlContentLength,
            },
          }).then(() => null, () => null);
          await supabaseAdmin.storage.from(BUCKET).remove([storagePath]).then(() => null, () => null);
          return Response.json(
            {
              error: FRIENDLY_SEND_ERROR,
              stage: "signed_url_preflight",
              detail: msg,
              http_status: signedUrlStatus,
              signed_url_status: signedUrlStatus,
              signed_url_content_type: signedUrlContentType,
              signed_url_content_length: signedUrlContentLength,
              media_mime: baseMime,
              media_size: file.size,
            },
            { status: 502 },
          );
        }

        const apiUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${integration.external_account_id}/messages`;
        const sentAt = new Date().toISOString();
        const payload = {
          messaging_product: "whatsapp",
          to: recipient,
          type: "audio",
          audio: { link: signed.signedUrl },
        };
        console.log("[AUDIO META REQUEST]", {
          comparison_with_working_text_endpoint: {
            same_integration_lookup: "lead.integration_id ou primeira integração whatsapp ativa da empresa",
            same_access_token_source: "integrations.access_token",
            access_token_debug: safeTokenDebug(integration.access_token),
            same_phone_number_id_source: "integrations.external_account_id",
            same_recipient_source: "lead.external_id ?? lead.phone normalizado para dígitos",
            same_graph_endpoint_shape: `https://graph.facebook.com/${GRAPH_VERSION}/{phone_number_id}/messages`,
          },
          apiUrl,
          graph_version: GRAPH_VERSION,
          payload,
          to: recipient,
          phone_number_id: integration.external_account_id,
          media_mime: baseMime,
          media_size: file.size,
          signed_url_status: signedUrlStatus,
          signed_url_content_type: signedUrlContentType,
          signed_url_content_length: signedUrlContentLength,
        });

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
          let apiJson: MetaAudioResponse = {};
          try {
            apiJson = JSON.parse(apiText);
          } catch {
            /* */
          }
          const err = apiJson.error ?? {};
          externalId = apiJson.messages?.[0]?.id ?? null;
          console.log("[AUDIO META RESPONSE]", {
            status: apiRes.status,
            http_status: apiRes.status,
            ok: apiRes.ok,
            body: apiText,
            parsed_body: apiJson,
            messages_0_id: externalId,
            error_message: err.message,
            error_code: err.code,
            error_subcode: err.error_subcode,
            fbtrace_id: err.fbtrace_id,
            payload,
            phone_number_id: integration.external_account_id,
            to: recipient,
            media_mime: baseMime,
            media_size: file.size,
            signed_url_status: signedUrlStatus,
            signed_url_content_type: signedUrlContentType,
            signed_url_content_length: signedUrlContentLength,
          });
          if (!([200, 201].includes(apiRes.status)) || !externalId) {
            const msg = err.message ?? (!externalId ? "Meta não retornou messages[0].id" : `HTTP ${apiRes.status}`);
            console.error("[AUDIO META RESPONSE]", {
              accepted_as_sent: false,
              status: apiRes.status,
              http_status: apiRes.status,
              message: err.message,
              code: err.code,
              error_subcode: err.error_subcode,
              fbtrace_id: err.fbtrace_id,
              body: apiText,
              parsed_body: apiJson,
              messages_0_id: externalId,
              payload,
              phone_number_id: integration.external_account_id,
              to: recipient,
              media_mime: baseMime,
              media_size: file.size,
              signed_url_status: signedUrlStatus,
              signed_url_content_type: signedUrlContentType,
              signed_url_content_length: signedUrlContentLength,
            });
            await supabaseAdmin.from("error_log").insert({
              company_id: companyId,
              user_id: userId,
              source: "whatsapp.send-audio",
              severity: "error",
              message: `meta: ${msg}`,
              context: {
                conversation_id: conversationId,
                lead_phone: recipient,
                phone_number_id: integration.external_account_id,
                payload,
                media_mime: baseMime,
                media_size: file.size,
                signed_url_status: signedUrlStatus,
                signed_url_content_type: signedUrlContentType,
                signed_url_content_length: signedUrlContentLength,
                http_status: apiRes.status,
                meta_error_message: err.message ?? null,
                meta_error_code: err.code ?? null,
                meta_error_subcode: err.error_subcode ?? null,
                meta_error_type: err.type ?? null,
                fbtrace_id: err.fbtrace_id ?? null,
                meta_body: apiText,
                meta_message_id: externalId,
              },
            }).then(() => null, () => null);
            await supabaseAdmin
              .from("integrations")
              .update({ last_error: msg })
              .eq("id", integration.id);
            await supabaseAdmin.storage.from(BUCKET).remove([storagePath]).then(() => null, () => null);
            return Response.json(
              {
                error: FRIENDLY_SEND_ERROR,
                stage: "meta_api",
                http_status: apiRes.status,
                status: apiRes.status,
                meta_error: err,
                meta_error_message: err.message ?? null,
                meta_error_code: err.code ?? null,
                meta_error_subcode: err.error_subcode ?? null,
                meta_error_type: err.type ?? null,
                fbtrace_id: err.fbtrace_id ?? null,
                meta_body: apiText,
                meta_message_id: externalId,
                payload,
                phone_number_id: integration.external_account_id,
                to: recipient,
                media_mime: baseMime,
                media_size: file.size,
                signed_url_status: signedUrlStatus,
                signed_url_content_type: signedUrlContentType,
                signed_url_content_length: signedUrlContentLength,
              },
              { status: 502 },
            );
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "falha de rede";
          console.error("[AUDIO META RESPONSE]", {
            accepted_as_sent: false,
            network_error: true,
            message: msg,
            status: null,
            http_status: null,
            body: null,
            messages_0_id: null,
            error_message: msg,
            error_code: null,
            error_subcode: null,
            fbtrace_id: null,
            payload,
            phone_number_id: integration.external_account_id,
            to: recipient,
            media_mime: baseMime,
            media_size: file.size,
            signed_url_status: signedUrlStatus,
            signed_url_content_type: signedUrlContentType,
            signed_url_content_length: signedUrlContentLength,
          });
          await supabaseAdmin.from("error_log").insert({
            company_id: companyId,
            user_id: userId,
            source: "whatsapp.send-audio",
            severity: "error",
            message: `network: ${msg}`,
            context: {
              conversation_id: conversationId,
              lead_phone: recipient,
              phone_number_id: integration.external_account_id,
              payload,
              media_mime: baseMime,
              media_size: file.size,
              signed_url_status: signedUrlStatus,
              signed_url_content_type: signedUrlContentType,
              signed_url_content_length: signedUrlContentLength,
            },
          }).then(() => null, () => null);
          await supabaseAdmin.storage.from(BUCKET).remove([storagePath]).then(() => null, () => null);
          return Response.json(
            { error: FRIENDLY_SEND_ERROR },
            { status: 502 },
          );
        }

        const { data: inserted, error: insertErr } = await supabaseAdmin
          .from("messages")
          .insert({
            company_id: companyId,
            conversation_id: conversationId,
            role: "agent",
            text: "[áudio]",
            at: sentAt,
            external_id: externalId,
            integration_id: integration.id,
            source_subtype: "audio",
            source_metadata: {
              media_url: storagePath,
              type: "audio",
              media_path: storagePath,
              media_kind: "audio",
              media_mime: baseMime,
              media_filename: storagePath.split("/").pop() ?? null,
              media_size: file.size,
              media_bucket: BUCKET,
              duration_seconds: duration && duration > 0 ? Math.round(duration) : null,
              voice: true,
            },
          })
          .select("id, conversation_id, role, text, at")
          .single();
        if (insertErr) {
          console.error("[send-audio] insert error", insertErr);
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
          duration: duration ?? null,
        });
      },
    },
  },
});
