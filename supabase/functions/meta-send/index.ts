// Edge Function: meta-send  (responder DM / comentário no IG / FB / Messenger)
//
// Body: { conversationId: string, text: string }
// Decide o tipo de envio com base na última mensagem da conversa:
//   - source=instagram subtype=dm        -> POST /{ig_business_id}/messages
//   - source=messenger subtype=dm        -> POST /{page_id}/messages
//   - source=facebook  subtype=comment   -> POST /{comment_id}/comments
//   - source=instagram subtype=comment   -> POST /{comment_id}/replies
//
// Só insere a mensagem (role=agent) se a Graph retornar um id válido.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.facebook.com/v21.0";

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/([a-z0-9-]+\.)*lovable\.app$/i,
  /^https:\/\/([a-z0-9-]+\.)*lovableproject\.com$/i,
  /^https:\/\/([a-z0-9-]+\.)*atendeaisolucoes\.online$/i,
  /^http:\/\/localhost(:\d+)?$/i,
];
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "null",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const originHeader = req.headers.get("Origin") ?? "";
  const originAllowed = cors["Access-Control-Allow-Origin"] !== "null";
  const requestId =
    req.headers.get("x-request-id") ??
    (globalThis.crypto?.randomUUID?.() ?? `req_${Date.now().toString(36)}`);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), {
      status: s,
      headers: { ...cors, "Content-Type": "application/json", "x-request-id": requestId },
    });
  console.log("META_SEND_REQUEST_RECEIVED", {
    requestId,
    method: req.method,
    origin: originHeader,
    originAllowed,
  });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST")
    return json({ ok: false, code: "invalid_payload", error: "method not allowed", requestId }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const accessToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!accessToken) {
    console.error("META_SEND_ERROR", { requestId, step: "auth", code: "unauthorized" });
    return json({ ok: false, code: "unauthorized", error: "unauthorized", requestId }, 401);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRes } = await sb.auth.getUser(accessToken);
  if (!userRes?.user) {
    console.error("META_SEND_ERROR", { requestId, step: "auth", code: "session_expired" });
    return json({ ok: false, code: "session_expired", error: "invalid session", requestId }, 401);
  }
  console.log("META_SEND_AUTH_VALIDATED", { requestId, userId: userRes.user.id });

  const { data: profile } = await sb
    .from("profiles")
    .select("company_id")
    .eq("id", userRes.user.id)
    .maybeSingle();
  const companyId = profile?.company_id;
  if (!companyId) {
    console.error("META_SEND_ERROR", { requestId, step: "company", code: "company_not_found" });
    return json({ ok: false, code: "company_not_found", error: "profile without company", requestId }, 403);
  }
  console.log("META_SEND_COMPANY_RESOLVED", {
    requestId,
    companyIdPrefix: String(companyId).slice(0, 8),
  });

  let body: {
    conversationId?: string;
    text?: string;
    channel?: string;
    phone?: string;
    contactName?: string;
    leadId?: string;
    imageUrls?: string[];
    subtype?: string;
    origin?: string;
    provider_type?: string;
    attemptId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, code: "invalid_payload", error: "invalid json", requestId }, 400);
  }

  const attemptId = typeof body.attemptId === "string" ? body.attemptId : null;

  const text = String(body.text ?? "").trim();
  const imageUrls = Array.isArray(body.imageUrls)
    ? body.imageUrls.filter((u) => typeof u === "string" && u.startsWith("http")).slice(0, 10)
    : [];
  if (!text && imageUrls.length === 0)
    return json({ ok: false, code: "invalid_payload", error: "text or imageUrls required", requestId, attemptId }, 400);
  if (text.length > 4000)
    return json({ ok: false, code: "text_too_long", error: "text too long", requestId, attemptId }, 400);

  // ---------------- WhatsApp Cloud API branch ----------------
  if (body.channel === "whatsapp") {
    const phoneDigitsForLog = String(body.phone ?? "").replace(/\D/g, "");
    const phoneMasked = phoneDigitsForLog.length > 4 ? `****${phoneDigitsForLog.slice(-4)}` : "****";
    console.log("META_SEND_PAYLOAD_VALIDATED", {
      requestId,
      attemptId,
      channel: "whatsapp",
      phoneMasked,
      hasLeadId: !!body.leadId,
      textLen: text.length,
      images: imageUrls.length,
    });

    let leadId = body.leadId ?? null;
    let conversationId: string | null = null;

    if (!leadId && !body.phone) {
      return json({ ok: false, code: "invalid_payload", error: "phone or leadId required", requestId, attemptId }, 400);
    }

    if (body.phone) {
      const phoneDigits = String(body.phone).replace(/\D/g, "");
      if (phoneDigits.length < 8 || phoneDigits.length > 15) {
        return json({ ok: false, code: "invalid_phone", error: "telefone inválido", requestId, attemptId }, 400);
      }
      if (!leadId) {
        const externalId = `phone:${phoneDigits}`;
        const { data: existing } = await sb
          .from("leads")
          .select("id")
          .eq("company_id", companyId)
          .eq("channel", "whatsapp")
          .or(`external_id.eq.${externalId},phone.eq.${phoneDigits}`)
          .limit(1)
          .maybeSingle();
        if (existing?.id) {
          leadId = existing.id;
        } else {
          const { data: newLead, error: leadErr } = await sb
            .from("leads")
            .insert({
              company_id: companyId,
              channel: "whatsapp",
              name: body.contactName?.trim() || `+${phoneDigits}`,
              phone: phoneDigits,
              external_id: externalId,
            })
            .select("id")
            .single();
          if (leadErr || !newLead) {
            console.error("META_SEND_ERROR lead create", leadErr);
            return json({ ok: false, code: "lead_creation_failed", error: "falha ao criar contato", requestId, attemptId }, 500);
          }
          leadId = newLead.id;
        }
      }
    }

    const { data: lead } = await sb
      .from("leads")
      .select("id, phone, external_id, integration_id, company_id")
      .eq("id", leadId!)
      .maybeSingle();
    if (!lead || lead.company_id !== companyId) {
      return json({ ok: false, code: "lead_not_found", error: "lead não encontrado", requestId, attemptId }, 404);
    }
    const recipient = String(lead.external_id ?? lead.phone ?? "").replace(/\D/g, "");
    if (recipient.length < 8 || recipient.length > 15) {
      return json({ ok: false, code: "invalid_phone", error: "lead sem telefone válido", requestId, attemptId }, 400);
    }

    const { data: existingConv } = await sb
      .from("conversations")
      .select("id")
      .eq("company_id", companyId)
      .eq("lead_id", leadId!)
      .eq("channel", "whatsapp")
      .maybeSingle();
    if (existingConv?.id) {
      conversationId = existingConv.id;
    } else {
      const { data: newConv, error: convErr } = await sb
        .from("conversations")
        .insert({
          company_id: companyId,
          lead_id: leadId!,
          channel: "whatsapp",
        })
        .select("id")
        .single();
      if (convErr || !newConv) {
        console.error("META_SEND_ERROR conv create", convErr);
        return json({ ok: false, code: "conversation_creation_failed", error: "falha ao criar conversa", requestId, attemptId }, 500);
      }
      conversationId = newConv.id;
    }

    const integrationQuery = sb
      .from("integrations")
      .select("id, access_token, external_account_id")
      .eq("company_id", companyId)
      .eq("channel", "whatsapp")
      .eq("active", true);
    const { data: integration } = lead.integration_id
      ? await integrationQuery.eq("id", lead.integration_id).maybeSingle()
      : await integrationQuery.limit(1).maybeSingle();

    const accessTok =
      integration?.access_token ||
      Deno.env.get("WHATSAPP_ACCESS_TOKEN") ||
      Deno.env.get("WHATSAPP_API_KEY") ||
      "";
    const phoneNumberId =
      integration?.external_account_id || Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
    if (!accessTok || !phoneNumberId) {
      return json({ ok: false, code: "whatsapp_not_connected", error: "WhatsApp não conectado para esta empresa", requestId, attemptId }, 400);
    }

    const apiUrl = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    const sentAt = new Date().toISOString();

    // Send images first (if any), then the text message.
    // The product-images bucket is private — convert any URL pointing to it
    // (path or legacy public URL) into a fresh signed URL so Meta can fetch.
    const signedImageUrls: string[] = [];
    for (const raw of imageUrls) {
      let path: string | null = null;
      const pubMarker = "/object/public/product-images/";
      const signMarker = "/object/sign/product-images/";
      if (raw.includes(pubMarker)) {
        path = raw.split(pubMarker)[1] ?? null;
      } else if (raw.includes(signMarker)) {
        // already signed — re-sign to guarantee TTL covers Meta fetch
        const rest = raw.split(signMarker)[1] ?? "";
        path = rest.split("?")[0] || null;
      }
      if (!path) {
        // Not a bucket URL (external CDN, etc.) — pass through unchanged.
        signedImageUrls.push(raw);
        continue;
      }
      const { data: signed, error: signErr } = await sb.storage
        .from("product-images")
        .createSignedUrl(decodeURIComponent(path), 60 * 60); // 1h
      if (signErr || !signed?.signedUrl) {
        console.error("WHATSAPP_IMAGE_SIGN_ERROR", { path, err: signErr?.message });
        return json(
          { ok: false, code: "media_sign_failed", error: `Não foi possível preparar a imagem para envio: ${signErr?.message ?? "sign failed"}`, requestId, attemptId },
          400,
        );
      }
      signedImageUrls.push(signed.signedUrl);
    }

    let lastImageExternalId: string | null = null;
    for (const imgUrl of signedImageUrls) {

      console.log("WHATSAPP_IMAGE_SEND_START", { imgUrl, to: recipient });
      // Validate URL is publicly reachable before asking Meta to fetch it
      try {
        const head = await fetch(imgUrl, { method: "HEAD" });
        if (!head.ok) {
          const msg = `Imagem inacessível (HTTP ${head.status}). Verifique se o bucket é público.`;
          console.error("WHATSAPP_IMAGE_SEND_ERROR", { stage: "validate", imgUrl, status: head.status });
          return json({ ok: false, code: "media_not_accessible", error: msg, requestId, attemptId }, 400);
        }
        const ct = head.headers.get("content-type") || "";
        if (ct && !ct.startsWith("image/")) {
          console.warn("WHATSAPP_IMAGE_SEND_WARN content-type", { imgUrl, ct });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "falha ao validar URL";
        console.error("WHATSAPP_IMAGE_SEND_ERROR", { stage: "validate-network", imgUrl, msg });
        return json({ ok: false, code: "media_url_invalid", error: `Não foi possível validar a imagem: ${msg}`, requestId, attemptId }, 400);
      }

      try {
        const imgRes = await fetch(apiUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessTok}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: recipient,
            type: "image",
            image: { link: imgUrl },
          }),
        });
        const imgText = await imgRes.text();
        let imgJson: { messages?: Array<{ id: string }>; error?: { message?: string; code?: number; type?: string } } = {};
        try {
          imgJson = JSON.parse(imgText);
        } catch {
          /* */
        }
        if (!imgRes.ok) {
          const metaErr = imgJson.error ?? {};
          const code = (metaErr as any)?.code as number | undefined;
          const subcode = (metaErr as any)?.error_subcode as number | undefined;
          const details = (metaErr as any)?.error_data?.details as string | undefined;
          const fbtrace = (metaErr as any)?.fbtrace_id as string | undefined;
          const rawMsg = (metaErr as any)?.message ?? `HTTP ${imgRes.status}`;
          console.error("META_SEND_META_ERROR", {
            stage: "image",
            status: imgRes.status,
            code: code ?? null,
            subcode: subcode ?? null,
            message: rawMsg,
            details: details ?? null,
            fbtrace_id: fbtrace ?? null,
            to: recipient,
            phone_number_id: phoneNumberId,
            body: imgText.slice(0, 1000),
          });
          const friendly =
            code === 131047
              ? "Esse cliente está fora da janela de 24 horas do WhatsApp. Para enviar nova mensagem, use um template aprovado."
              : `WhatsApp imagem: ${rawMsg}`;
          return json(
            {
              ok: false,
              code: code === 131047 ? "outside_24h_window" : "graph_api_rejected",
              error: friendly,
              metaCode: code ?? null,
              outside24hWindow: code === 131047,
              metaError: metaErr,
              status: imgRes.status,
              requestId,
              attemptId,
            },
            502,
          );
        }
        const imgExternalId = imgJson.messages?.[0]?.id ?? null;
        lastImageExternalId = imgExternalId;
        console.log("WHATSAPP_IMAGE_SEND_SUCCESS", { externalId: imgExternalId, imgUrl });

        await sb.from("messages").insert({
          company_id: companyId,
          conversation_id: conversationId!,
          role: "agent",
          text: imgUrl,
          at: new Date().toISOString(),
          external_id: imgExternalId,
          integration_id: integration?.id ?? null,
        });
        await sb.from("whatsapp_messages").insert({
          company_id: companyId,
          numero: recipient,
          mensagem: imgUrl,
          direction: "out",
          origem: "meta_cloud_api",
          whatsapp_jid: `${recipient}@s.whatsapp.net`,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "falha de rede";
        console.error("WHATSAPP_IMAGE_SEND_ERROR", { stage: "network", imgUrl, msg });
        return json({ ok: false, code: "network_error", error: `Falha ao enviar imagem: ${msg}`, requestId, attemptId }, 502);
      }
    }

    // If there's no text body, finalize after images
    if (!text) {
      await sb
        .from("conversations")
        .update({ last_message_at: sentAt, awaiting_reply: false, unread: 0 })
        .eq("id", conversationId!);
      if (integration?.id) {
        await sb
          .from("integrations")
          .update({ last_synced_at: sentAt, last_error: null })
          .eq("id", integration.id);
      }
      console.log("META_SEND_SUCCESS", { requestId, attemptId, phase: "images_only", externalId: lastImageExternalId });
      return json({
        ok: true,
        messageId: lastImageExternalId,
        conversationId,
        leadId,
        at: sentAt,
        imagesSent: imageUrls.length,
        requestId,
        attemptId,
      });
    }

    let externalId: string | null = null;
    try {
      const apiRes = await fetch(apiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessTok}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipient,
          type: "text",
          text: { body: text },
        }),
      });
      const apiText = await apiRes.text();
      let apiJson: {
        messages?: Array<{ id: string }>;
        error?: { message?: string; code?: number; type?: string };
      } = {};
      try {
        apiJson = JSON.parse(apiText);
      } catch {
        /* */
      }
      if (!apiRes.ok) {
        const metaErr = apiJson.error ?? {};
        const code = (metaErr as any)?.code as number | undefined;
        const subcode = (metaErr as any)?.error_subcode as number | undefined;
        const details = (metaErr as any)?.error_data?.details as string | undefined;
        const fbtrace = (metaErr as any)?.fbtrace_id as string | undefined;
        const rawMsg = (metaErr as any)?.message ?? `HTTP ${apiRes.status}`;
        console.error("META_SEND_META_ERROR", {
          status: apiRes.status,
          code: code ?? null,
          subcode: subcode ?? null,
          message: rawMsg,
          details: details ?? null,
          fbtrace_id: fbtrace ?? null,
          to: recipient,
          phone_number_id: phoneNumberId,
          body: apiText.slice(0, 1000),
        });
        // 131047 = re-engagement / fora da janela de 24h.
        const friendly =
          code === 131047
            ? "Esse cliente está fora da janela de 24 horas do WhatsApp. Para enviar nova mensagem, use um template aprovado."
            : `WhatsApp API: ${rawMsg}`;
        if (integration?.id) {
          await sb.from("integrations").update({ last_error: rawMsg }).eq("id", integration.id);
        }
        return json(
          {
            ok: false,
            code: code === 131047 ? "outside_24h_window" : code === 4 || code === 80007 ? "graph_rate_limited" : "graph_api_rejected",
            error: friendly,
            metaCode: code ?? null,
            outside24hWindow: code === 131047,
            metaError: metaErr,
            status: apiRes.status,
            requestId,
            attemptId,
          },
          502,
        );
      }
      externalId = apiJson.messages?.[0]?.id ?? null;
      console.log("META_SEND_SUCCESS", { externalId, to: recipient });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "falha de rede";
      console.error("META_SEND_ERROR network", msg);
      return json({ ok: false, code: "network_error", error: `Falha ao enviar: ${msg}`, requestId, attemptId }, 502);
    }

    const { data: inserted, error: insertErr } = await sb
      .from("messages")
      .insert({
        company_id: companyId,
        conversation_id: conversationId!,
        role: "agent",
        text,
        at: sentAt,
        external_id: externalId,
        integration_id: integration?.id ?? null,
      })
      .select("id")
      .single();
    if (insertErr) {
      console.error("META_SEND_ERROR insert msg", insertErr);
      return json({ ok: false, code: "message_persistence_failed", error: "Falha ao salvar mensagem", requestId, attemptId }, 500);
    }

    await sb
      .from("conversations")
      .update({
        last_message_at: sentAt,
        awaiting_reply: false,
        unread: 0,
      })
      .eq("id", conversationId!);

    if (integration?.id) {
      await sb
        .from("integrations")
        .update({ last_synced_at: sentAt, last_error: null })
        .eq("id", integration.id);
    }

    await sb.from("whatsapp_messages").insert({
      company_id: companyId,
      numero: recipient,
      mensagem: text,
      direction: "out",
      origem: "meta_cloud_api",
      whatsapp_jid: `${recipient}@s.whatsapp.net`,
    });

    console.log("META_SEND_SUCCESS", { requestId, attemptId, phase: "text", externalId });
    return json({
      ok: true,
      messageId: externalId,
      id: inserted.id,
      conversationId,
      leadId,
      at: sentAt,
      requestId,
      attemptId,
    });
  }
  // ---------------- end WhatsApp branch ----------------

  const conversationId = String(body.conversationId ?? "");
  if (!conversationId) return json({ ok: false, error: "conversationId required" }, 400);

  // Load conversation + lead + last incoming message metadata.
  const { data: conv } = await sb
    .from("conversations")
    .select("id, lead_id, company_id, channel, interaction_type")
    .eq("id", conversationId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!conv) return json({ ok: false, error: "conversation not found" }, 404);

  const { data: lead } = await sb
    .from("leads")
    .select("id, source, source_sender_id, source_page_id")
    .eq("id", conv.lead_id)
    .maybeSingle();
  if (!lead?.source) return json({ ok: false, error: "lead has no social source" }, 400);

  const { data: lastIn } = await sb
    .from("messages")
    .select("source, source_subtype, source_metadata")
    .eq("conversation_id", conversationId)
    .eq("role", "lead")
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const requestedProviderType = String(body.provider_type ?? body.origin ?? "");
  const requestedSubtype = String(body.subtype ?? "");
  const conversationInteraction = String((conv as any).interaction_type ?? "direct_message");
  const isRequestedComment =
    requestedProviderType.endsWith("_comment") || requestedSubtype === "comment";
  const subtype =
    isRequestedComment ||
    conversationInteraction === "comment" ||
    lastIn?.source_subtype === "comment"
      ? "comment"
      : "dm";
  const providerType =
    lead.source === "instagram"
      ? subtype === "comment"
        ? "instagram_comment"
        : "instagram_direct"
      : lead.source === "messenger"
        ? "messenger"
        : subtype === "comment"
          ? "facebook_comment"
          : "facebook";

  // Find page + token
  const { data: page } = await sb
    .from("meta_pages")
    .select("page_id, ig_business_account_id, page_access_token, ig_user_access_token")
    .eq("company_id", companyId)
    .eq("page_id", lead.source_page_id ?? "")
    .maybeSingle();
  if (!page) {
    if (lead.source === "instagram") {
      const logName =
        subtype === "comment" ? "INSTAGRAM_COMMENT_REPLY_ERROR" : "INSTAGRAM_DIRECT_SEND_ERROR";
      console.error(logName, {
        reason: "page_not_connected",
        sourcePageId: lead.source_page_id ?? null,
      });
    }
    if (lead.source === "messenger" || lead.source === "facebook") {
      console.error("FACEBOOK_MESSAGE_SEND_ERROR", {
        reason: "page_not_connected",
        sourcePageId: lead.source_page_id ?? null,
      });
    }
    return json({ ok: false, error: "page not connected" }, 400);
  }

  // Choose the right token per provider:
  // - Instagram flows prefer the Instagram Login token (IGAA...) when available,
  //   falling back to the Page Access Token.
  // - Facebook Messenger / Facebook comments always use the Page Access Token (EAA...).
  const igUserToken = (page as any).ig_user_access_token as string | null;
  const fbPageToken = page.page_access_token as string;
  const isInstagramFlow =
    providerType === "instagram_direct" || providerType === "instagram_comment";
  const pageToken = isInstagramFlow ? (igUserToken || fbPageToken) : fbPageToken;
  const isIgLoginToken = typeof pageToken === "string" && pageToken.startsWith("IGAA");
  const IG_GRAPH = "https://graph.instagram.com/v21.0";
  const igHost = isIgLoginToken ? IG_GRAPH : GRAPH;
  let graphUrl: string;
  let graphBody: Record<string, unknown>;

  if (providerType === "instagram_comment" || providerType === "facebook_comment") {
    const commentId = (lastIn?.source_metadata as any)?.comment_id;
    if (!commentId) {
      if (providerType === "instagram_comment") {
        console.error("INSTAGRAM_COMMENT_REPLY_ERROR", {
          reason: "missing_comment_id",
          conversationId,
        });
      }
      return json({ ok: false, error: "no comment_id to reply to" }, 400);
    }
    if (providerType === "instagram_comment") {
      graphUrl = `${igHost}/${commentId}/replies`;
      graphBody = { message: text };
    } else {
      graphUrl = `${GRAPH}/${commentId}/comments`;
      graphBody = { message: text };
    }
  } else {
    // DM (instagram or messenger)
    const recipientId = lead.source_sender_id;
    if (!recipientId) {
      if (providerType === "instagram_direct") {
        console.error("INSTAGRAM_DIRECT_SEND_ERROR", {
          reason: "missing_recipient_id",
          conversationId,
        });
      }
      return json({ ok: false, error: "no recipient id" }, 400);
    }
    if (providerType === "instagram_direct") {
      // Instagram Messaging API: POST /{ig_business_account_id}/messages
      const igId = page.ig_business_account_id;
      if (!igId) {
        console.error("INSTAGRAM_DIRECT_SEND_ERROR", {
          reason: "missing ig_business_account_id",
          pageId: page.page_id,
        });
        return json(
          { ok: false, error: "Conta Instagram Business não vinculada a esta página" },
          400,
        );
      }
      // With IG Login token, /me/messages is the canonical endpoint.
      graphUrl = isIgLoginToken ? `${igHost}/me/messages` : `${GRAPH}/${igId}/messages`;
      graphBody = {
        recipient: { id: recipientId },
        message: { text },
      };
    } else {
      graphUrl = `${GRAPH}/${page.page_id}/messages`;
      graphBody = {
        recipient: { id: recipientId },
        message: { text },
        messaging_type: "RESPONSE",
      };
    }
  }

  const isInstagramDirect = providerType === "instagram_direct";
  const isInstagramComment = providerType === "instagram_comment";
  const isMessenger = providerType === "messenger" || providerType === "facebook";
  const isFacebookComment = providerType === "facebook_comment";
  const igCommentId =
    providerType === "instagram_comment"
      ? ((lastIn?.source_metadata as any)?.comment_id ?? null)
      : null;
  const igMediaId =
    providerType === "instagram_comment"
      ? ((lastIn?.source_metadata as any)?.media_id ?? null)
      : null;
  const fbCommentId = isFacebookComment
    ? ((lastIn?.source_metadata as any)?.comment_id ?? null)
    : null;

  if (isInstagramDirect) {
    console.log("INSTAGRAM_DIRECT_SEND_START", {
      endpoint: graphUrl,
      igBusinessAccountId: page.ig_business_account_id,
      pageId: page.page_id,
      recipientId: lead.source_sender_id,
      textLen: text.length,
    });
  }
  if (isInstagramComment) {
    console.log("INSTAGRAM_COMMENT_REPLY_START", {
      endpoint: graphUrl,
      commentId: igCommentId,
      mediaId: igMediaId,
      pageId: page.page_id,
      igBusinessAccountId: page.ig_business_account_id,
      textLen: text.length,
    });
    console.log("INSTAGRAM_COMMENT_REPLY_REQUEST", {
      endpoint: graphUrl,
      method: "POST",
      commentId: igCommentId,
      mediaId: igMediaId,
      igBusinessAccountId: page.ig_business_account_id,
      body: graphBody,
    });
  }
  if (isMessenger) {
    console.log("FACEBOOK_MESSAGE_SEND_REQUEST", {
      endpoint: graphUrl,
      method: "POST",
      pageId: page.page_id,
      recipientId: lead.source_sender_id,
      body: graphBody,
      tokenPrefix: typeof pageToken === "string" ? pageToken.slice(0, 6) : null,
    });
  }
  if (isFacebookComment) {
    // Pre-flight: validate token type + identity BEFORE attempting the reply.
    try {
      const meRes = await fetch(
        `${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(pageToken)}`,
      );
      const meBody = await meRes.json().catch(() => ({}));
      const tokenIsForPage = String(meBody?.id ?? "") === String(page.page_id);
      const tokenPrefix = typeof pageToken === "string" ? pageToken.slice(0, 8) : null;
      console.log("FACEBOOK_COMMENT_REPLY_TOKEN_CHECK", {
        endpoint: `${GRAPH}/me`,
        status: meRes.status,
        me: meBody,
        pageId: page.page_id,
        tokenPrefix,
        tokenIsForPage,
        tokenType: tokenIsForPage ? "PAGE" : "USER_OR_OTHER",
      });
      if (!tokenIsForPage) {
        console.error("FACEBOOK_COMMENT_REPLY_ERROR", {
          reason: "not_a_page_token",
          pageId: page.page_id,
          me: meBody,
        });
        return json(
          {
            ok: false,
            error:
              "Token armazenado não é o Page Access Token da página. Reconecte o Facebook em Configurações → Integrações.",
          },
          400,
        );
      }
    } catch (e) {
      console.error("FACEBOOK_COMMENT_REPLY_TOKEN_CHECK_ERROR", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    console.log("FACEBOOK_COMMENT_REPLY_REQUEST", {
      endpoint: graphUrl,
      method: "POST",
      pageId: page.page_id,
      commentId: fbCommentId,
      tokenPrefix: typeof pageToken === "string" ? pageToken.slice(0, 8) : null,
      body: graphBody,
    });
  }
  console.log("META_SEND_URL", graphUrl);

  let res: Response;
  try {
    res = await fetch(graphUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pageToken}` },
      body: JSON.stringify(graphBody),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isInstagramDirect) {
      console.error("INSTAGRAM_DIRECT_SEND_ERROR", {
        reason: "network_error",
        endpoint: graphUrl,
        error: message,
      });
    }
    if (isInstagramComment) {
      console.error("INSTAGRAM_COMMENT_REPLY_ERROR", {
        reason: "network_error",
        endpoint: graphUrl,
        commentId: igCommentId,
        igBusinessAccountId: page.ig_business_account_id,
        error: message,
      });
    }
    if (isMessenger) {
      console.error("FACEBOOK_MESSAGE_SEND_ERROR", {
        reason: "network_error",
        endpoint: graphUrl,
        pageId: page.page_id,
        recipientId: lead.source_sender_id,
        error: message,
      });
    }
    if (isFacebookComment) {
      console.error("FACEBOOK_COMMENT_REPLY_ERROR", {
        reason: "network_error",
        endpoint: graphUrl,
        pageId: page.page_id,
        commentId: fbCommentId,
        error: message,
      });
    }
    // Return 200 so supabase.functions.invoke surfaces the body as `data`
    return json({
      ok: false,
      error: `Falha de rede com a Meta: ${message}`,
      networkError: true,
      endpoint: graphUrl,
    });
  }
  const raw = await res.text();
  console.log("META_SEND_STATUS", res.status, raw.slice(0, 500));

  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* ignore */
  }

  if (isInstagramComment) {
    console.log("INSTAGRAM_COMMENT_REPLY_META_RESPONSE", {
      endpoint: graphUrl,
      status: res.status,
      commentId: igCommentId,
      mediaId: igMediaId,
      igBusinessAccountId: page.ig_business_account_id,
      body: parsed ?? raw.slice(0, 1000),
    });
  }
  if (isInstagramDirect) {
    console.log("INSTAGRAM_DIRECT_SEND_META_RESPONSE", {
      endpoint: graphUrl,
      status: res.status,
      igBusinessAccountId: page.ig_business_account_id,
      recipientId: lead.source_sender_id,
      body: parsed ?? raw.slice(0, 1000),
    });
  }

  if (isMessenger) {
    console.log("FACEBOOK_MESSAGE_SEND_RESPONSE", {
      endpoint: graphUrl,
      status: res.status,
      pageId: page.page_id,
      recipientId: lead.source_sender_id,
      body: parsed ?? raw.slice(0, 1000),
    });
  }
  if (isFacebookComment) {
    console.log("FACEBOOK_COMMENT_REPLY_RESPONSE", {
      endpoint: graphUrl,
      status: res.status,
      pageId: page.page_id,
      commentId: fbCommentId,
      body: parsed ?? raw.slice(0, 1000),
    });
  }

  const messageId = parsed?.message_id ?? parsed?.id ?? null;

  if (!res.ok || !messageId) {
    const errMsg = parsed?.error?.message ?? raw.slice(0, 200) ?? `HTTP ${res.status}`;
    if (isInstagramDirect) {
      console.error("INSTAGRAM_DIRECT_SEND_ERROR", {
        endpoint: graphUrl,
        status: res.status,
        igBusinessAccountId: page.ig_business_account_id,
        recipientId: lead.source_sender_id,
        error: parsed?.error ?? null,
        body: raw.slice(0, 1000),
      });
    }
    if (isInstagramComment) {
      console.error("INSTAGRAM_COMMENT_REPLY_ERROR", {
        endpoint: graphUrl,
        status: res.status,
        commentId: igCommentId,
        mediaId: igMediaId,
        igBusinessAccountId: page.ig_business_account_id,
        error: parsed?.error ?? null,
        body: raw.slice(0, 1000),
      });
    }
    if (isMessenger) {
      console.error("FACEBOOK_MESSAGE_SEND_ERROR", {
        endpoint: graphUrl,
        status: res.status,
        pageId: page.page_id,
        recipientId: lead.source_sender_id,
        error: parsed?.error ?? null,
        body: raw.slice(0, 1000),
      });
    }
    if (isFacebookComment) {
      console.error("FACEBOOK_COMMENT_REPLY_ERROR", {
        endpoint: graphUrl,
        status: res.status,
        pageId: page.page_id,
        commentId: fbCommentId,
        error: parsed?.error ?? null,
        body: raw.slice(0, 1000),
      });
    }
    // Return HTTP 200 with the full Meta error body so supabase.functions.invoke
    // surfaces it as `data` (avoids the generic "non-2xx status code" wrapper).
    return json({
      ok: false,
      error: errMsg,
      metaError: parsed?.error ?? null,
      metaResponse: parsed ?? raw.slice(0, 1000),
      status: res.status,
      endpoint: graphUrl,
      providerType,
      commentId: igCommentId,
      igBusinessAccountId: page.ig_business_account_id,
    });
  }

  const sentAt = new Date().toISOString();
  const { data: inserted, error: insertErr } = await sb
    .from("messages")
    .insert({
      company_id: companyId,
      conversation_id: conversationId,
      role: "agent",
      text,
      at: sentAt,
      external_id: String(messageId),
      source: lead.source,
      source_subtype: subtype,
      source_metadata: { provider_type: providerType, reply_to: lastIn?.source_metadata ?? null },
    })
    .select("id")
    .single();
  if (insertErr || !inserted) {
    const logName = isInstagramDirect
      ? "INSTAGRAM_DIRECT_SEND_ERROR"
      : isInstagramComment
        ? "INSTAGRAM_COMMENT_REPLY_ERROR"
        : "META_SEND_ERROR";
    console.error(logName, {
      reason: "database_insert_failed",
      error: insertErr,
      messageId,
      providerType,
    });
    return json(
      {
        ok: false,
        error: "Mensagem enviada na Meta, mas falhou ao salvar no banco",
        dbError: insertErr,
      },
      500,
    );
  }
  await sb
    .from("conversations")
    .update({ last_message_at: sentAt, awaiting_reply: false })
    .eq("id", conversationId);

  if (isInstagramDirect) {
    console.log("INSTAGRAM_DIRECT_SEND_SUCCESS", { messageId, recipientId: lead.source_sender_id });
  }
  if (isInstagramComment) {
    console.log("INSTAGRAM_COMMENT_REPLY_SUCCESS", {
      messageId,
      commentId: (lastIn?.source_metadata as any)?.comment_id ?? null,
    });
  }
  if (isMessenger) {
    console.log("FACEBOOK_MESSAGE_SEND_SUCCESS", {
      messageId,
      pageId: page.page_id,
      recipientId: lead.source_sender_id,
    });
  }
  if (isFacebookComment) {
    console.log("FACEBOOK_COMMENT_REPLY_SUCCESS", {
      messageId,
      pageId: page.page_id,
      commentId: fbCommentId,
    });
  }

  return json({ ok: true, messageId, id: inserted.id, at: sentAt, provider_type: providerType });
});
