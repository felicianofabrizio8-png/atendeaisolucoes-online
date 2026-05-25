// Edge Function: meta-webhook  (Instagram / Facebook / Messenger)
// PUBLIC — verify_jwt=false (config.toml).
//
// GET:  verificação do webhook Meta (hub.verify_token vs META_VERIFY_TOKEN).
// POST: recebe eventos. Valida assinatura X-Hub-Signature-256 (HMAC SHA-256 com META_APP_SECRET).
//       Para cada evento, faz upsert de lead + conversation + insere message.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.facebook.com/v21.0";

function text(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

async function verifySignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature || !signature.startsWith("sha256=")) return false;
  const provided = signature.slice(7);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(META_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

type Sb = ReturnType<typeof createClient>;

async function fetchPsidName(psid: string, pageToken: string): Promise<string | null> {
  try {
    const r = await fetch(`${GRAPH}/${psid}?fields=name&access_token=${encodeURIComponent(pageToken)}`);
    if (!r.ok) return null;
    const j = await r.json();
    return j?.name ?? null;
  } catch {
    return null;
  }
}

async function upsertLeadAndConversation(
  sb: Sb,
  opts: {
    companyId: string;
    source: "instagram" | "facebook" | "messenger";
    senderId: string;
    pageId: string;
    name: string | null;
    channel: "instagram" | "facebook" | "whatsapp";
  },
): Promise<{ leadId: string; conversationId: string }> {
  // upsert lead
  const { data: existing } = await sb
    .from("leads")
    .select("id")
    .eq("company_id", opts.companyId)
    .eq("source", opts.source)
    .eq("source_sender_id", opts.senderId)
    .maybeSingle();

  let leadId: string;
  if (existing?.id) {
    leadId = existing.id as string;
    if (opts.name) {
      await sb.from("leads").update({ name: opts.name, source_page_id: opts.pageId }).eq("id", leadId);
    }
  } else {
    const { data: inserted, error: insErr } = await sb
      .from("leads")
      .insert({
        company_id: opts.companyId,
        name: opts.name ?? `${opts.source} ${opts.senderId.slice(0, 6)}`,
        channel: opts.channel,
        source: opts.source,
        source_sender_id: opts.senderId,
        source_page_id: opts.pageId,
        status: "novo",
        tags: [],
      })
      .select("id")
      .single();
    if (insErr) throw insErr;
    leadId = inserted!.id as string;
  }

  // get or create conversation
  const { data: conv } = await sb
    .from("conversations")
    .select("id")
    .eq("company_id", opts.companyId)
    .eq("lead_id", leadId)
    .maybeSingle();

  if (conv?.id) return { leadId, conversationId: conv.id as string };

  const { data: newConv, error: convErr } = await sb
    .from("conversations")
    .insert({
      company_id: opts.companyId,
      lead_id: leadId,
      channel: opts.channel,
      awaiting_reply: true,
      unread: 1,
    })
    .select("id")
    .single();
  if (convErr) throw convErr;
  return { leadId, conversationId: newConv!.id as string };
}

async function insertMessage(
  sb: Sb,
  opts: {
    companyId: string;
    conversationId: string;
    text: string;
    externalId: string | null;
    source: string;
    subtype: string;
    metadata: Record<string, unknown>;
  },
) {
  // dedupe by external_id
  if (opts.externalId) {
    const { data: dup } = await sb
      .from("messages")
      .select("id")
      .eq("company_id", opts.companyId)
      .eq("external_id", opts.externalId)
      .maybeSingle();
    if (dup?.id) return;
  }
  await sb.from("messages").insert({
    company_id: opts.companyId,
    conversation_id: opts.conversationId,
    role: "lead",
    text: opts.text,
    external_id: opts.externalId,
    source: opts.source,
    source_subtype: opts.subtype,
    source_metadata: opts.metadata,
  });
  await sb
    .from("conversations")
    .update({ last_message_at: new Date().toISOString(), awaiting_reply: true })
    .eq("id", opts.conversationId);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  console.log("META_WEBHOOK_REQUEST", {
    method: req.method,
    url: req.url,
    ua: req.headers.get("user-agent"),
    hasSig: !!req.headers.get("x-hub-signature-256"),
  });

  // ---- Verification (GET) ----
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && token === META_VERIFY_TOKEN && challenge) {
      console.log("META_WEBHOOK_VERIFIED");
      return text(challenge, 200);
    }
    console.log("META_WEBHOOK_VERIFY_FAILED", { mode, hasToken: !!token, tokenMatch: token === META_VERIFY_TOKEN });
    return text("forbidden", 403);
  }

  if (req.method !== "POST") return text("method not allowed", 405);

  const raw = await req.text();
  console.log("META_WEBHOOK_RAW_BODY", raw.slice(0, 4000));

  const sig = req.headers.get("x-hub-signature-256");
  const valid = await verifySignature(raw, sig);
  if (!valid) {
    console.log("META_WEBHOOK_BAD_SIGNATURE", { sigPreview: sig?.slice(0, 20) });
    return text("invalid signature", 401);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return text("bad json", 400);
  }

  console.log("META_WEBHOOK_PARSED", {
    object: body?.object,
    entryCount: Array.isArray(body?.entry) ? body.entry.length : 0,
    entryIds: (Array.isArray(body?.entry) ? body.entry : []).map((e: any) => e?.id),
  });

  const object = body?.object as string | undefined;
  const entries = Array.isArray(body?.entry) ? body.entry : [];

  for (const entry of entries) {
    // Identify the page/account this entry belongs to.
    const entryId = String(entry?.id ?? "");
    if (!entryId) continue;

    // Locate page (and company) by page_id OR ig_business_account_id.
    const { data: page } = await sb
      .from("meta_pages")
      .select("company_id, page_id, page_access_token, ig_business_account_id")
      .or(`page_id.eq.${entryId},ig_business_account_id.eq.${entryId}`)
      .maybeSingle();

    if (!page) {
      console.log("META_WEBHOOK_PAGE_NOT_FOUND", entryId);
      continue;
    }

    const companyId = page.company_id as string;
    const pageToken = page.page_access_token as string;
    const pageId = page.page_id as string;
    const isInstagram = object === "instagram" || entry?.id === page.ig_business_account_id;

    // -------- Messenger / IG DMs (entry.messaging[]) --------
    const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const m of messaging) {
      try {
        const senderId = String(m?.sender?.id ?? "");
        const recipientId = String(m?.recipient?.id ?? "");
        if (!senderId || senderId === pageId || senderId === page.ig_business_account_id) continue;

        const text = m?.message?.text ?? m?.message?.attachments?.[0]?.payload?.url ?? "[mídia]";
        const mid = m?.message?.mid ?? null;
        const source: "instagram" | "messenger" = isInstagram ? "instagram" : "messenger";
        const channel: "instagram" | "facebook" = isInstagram ? "instagram" : "facebook";

        const name = await fetchPsidName(senderId, pageToken);

        const { conversationId } = await upsertLeadAndConversation(sb, {
          companyId,
          source,
          senderId,
          pageId,
          name,
          channel,
        });

        await insertMessage(sb, {
          companyId,
          conversationId,
          text: String(text),
          externalId: mid ? String(mid) : null,
          source,
          subtype: "dm",
          metadata: { recipient_id: recipientId, raw: m },
        });
      } catch (e) {
        console.error("META_WEBHOOK_DM_ERROR", e instanceof Error ? e.message : String(e));
      }
    }

    // -------- Changes (comments on posts / IG comments) --------
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const ch of changes) {
      try {
        const field = ch?.field as string;
        const value = ch?.value ?? {};

        // Facebook feed comments
        if (field === "feed" && value?.item === "comment" && value?.verb === "add") {
          const senderId = String(value?.from?.id ?? "");
          const senderName = value?.from?.name ?? null;
          const commentId = String(value?.comment_id ?? "");
          const postId = String(value?.post_id ?? "");
          const message = value?.message ?? "";
          if (!senderId || senderId === pageId) continue;

          const { conversationId } = await upsertLeadAndConversation(sb, {
            companyId,
            source: "facebook",
            senderId,
            pageId,
            name: senderName,
            channel: "facebook",
          });
          await insertMessage(sb, {
            companyId,
            conversationId,
            text: String(message),
            externalId: commentId || null,
            source: "facebook",
            subtype: "comment",
            metadata: { comment_id: commentId, post_id: postId, raw: value },
          });
          continue;
        }

        // Instagram comments
        if (field === "comments") {
          const senderId = String(value?.from?.id ?? "");
          const senderName = value?.from?.username ?? null;
          const commentId = String(value?.id ?? "");
          const mediaId = String(value?.media?.id ?? "");
          const message = value?.text ?? "";
          if (!senderId || senderId === page.ig_business_account_id) continue;

          const { conversationId } = await upsertLeadAndConversation(sb, {
            companyId,
            source: "instagram",
            senderId,
            pageId,
            name: senderName,
            channel: "instagram",
          });
          await insertMessage(sb, {
            companyId,
            conversationId,
            text: String(message),
            externalId: commentId || null,
            source: "instagram",
            subtype: "comment",
            metadata: { comment_id: commentId, media_id: mediaId, raw: value },
          });
        }
      } catch (e) {
        console.error("META_WEBHOOK_CHANGE_ERROR", e instanceof Error ? e.message : String(e));
      }
    }
  }

  return text("ok", 200);
});
