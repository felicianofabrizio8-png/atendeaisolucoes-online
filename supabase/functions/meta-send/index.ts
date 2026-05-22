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

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const accessToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!accessToken) return json({ ok: false, error: "unauthorized" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRes } = await sb.auth.getUser(accessToken);
  if (!userRes?.user) return json({ ok: false, error: "invalid session" }, 401);

  const { data: profile } = await sb
    .from("profiles").select("company_id").eq("id", userRes.user.id).maybeSingle();
  const companyId = profile?.company_id;
  if (!companyId) return json({ ok: false, error: "profile without company" }, 403);

  let body: { conversationId?: string; text?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }

  const conversationId = String(body.conversationId ?? "");
  const text = String(body.text ?? "").trim();
  if (!conversationId || !text) return json({ ok: false, error: "conversationId and text required" }, 400);
  if (text.length > 4000) return json({ ok: false, error: "text too long" }, 400);

  // Load conversation + lead + last incoming message metadata.
  const { data: conv } = await sb
    .from("conversations")
    .select("id, lead_id, company_id, channel")
    .eq("id", conversationId).eq("company_id", companyId).maybeSingle();
  if (!conv) return json({ ok: false, error: "conversation not found" }, 404);

  const { data: lead } = await sb
    .from("leads").select("id, source, source_sender_id, source_page_id")
    .eq("id", conv.lead_id).maybeSingle();
  if (!lead?.source) return json({ ok: false, error: "lead has no social source" }, 400);

  const { data: lastIn } = await sb
    .from("messages")
    .select("source, source_subtype, source_metadata")
    .eq("conversation_id", conversationId)
    .eq("role", "lead")
    .order("at", { ascending: false })
    .limit(1).maybeSingle();

  const subtype = (lastIn?.source_subtype as string | undefined) ?? "dm";

  // Find page + token
  const { data: page } = await sb
    .from("meta_pages")
    .select("page_id, ig_business_account_id, page_access_token")
    .eq("company_id", companyId)
    .eq("page_id", lead.source_page_id ?? "")
    .maybeSingle();
  if (!page) return json({ ok: false, error: "page not connected" }, 400);

  const pageToken = page.page_access_token as string;
  let graphUrl: string;
  let graphBody: Record<string, unknown>;

  if (subtype === "comment") {
    const commentId = (lastIn?.source_metadata as any)?.comment_id;
    if (!commentId) return json({ ok: false, error: "no comment_id to reply to" }, 400);
    if (lead.source === "instagram") {
      graphUrl = `${GRAPH}/${commentId}/replies`;
      graphBody = { message: text };
    } else {
      graphUrl = `${GRAPH}/${commentId}/comments`;
      graphBody = { message: text };
    }
  } else {
    // DM (instagram or messenger)
    const recipientId = lead.source_sender_id;
    if (!recipientId) return json({ ok: false, error: "no recipient id" }, 400);
    if (lead.source === "instagram") {
      // IG messaging uses page id as sender; Graph endpoint /{page_id}/messages with messaging_type
      graphUrl = `${GRAPH}/${page.page_id}/messages`;
    } else {
      graphUrl = `${GRAPH}/${page.page_id}/messages`;
    }
    graphBody = {
      recipient: { id: recipientId },
      message: { text },
      messaging_type: "RESPONSE",
    };
  }

  console.log("META_SEND_URL", graphUrl);
  console.log("META_SEND_PAYLOAD", JSON.stringify(graphBody));

  const res = await fetch(`${graphUrl}?access_token=${encodeURIComponent(pageToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(graphBody),
  });
  const raw = await res.text();
  console.log("META_SEND_STATUS", res.status, raw.slice(0, 500));

  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch { /* ignore */ }
  const messageId = parsed?.message_id ?? parsed?.id ?? null;

  if (!res.ok || !messageId) {
    const errMsg = parsed?.error?.message ?? raw.slice(0, 200) ?? `HTTP ${res.status}`;
    return json({ ok: false, error: errMsg }, 400);
  }

  await sb.from("messages").insert({
    company_id: companyId,
    conversation_id: conversationId,
    role: "agent",
    text,
    external_id: String(messageId),
    source: lead.source,
    source_subtype: subtype,
    source_metadata: { reply_to: lastIn?.source_metadata ?? null },
  });
  await sb.from("conversations")
    .update({ last_message_at: new Date().toISOString(), awaiting_reply: false })
    .eq("id", conversationId);

  return json({ ok: true, messageId });
});
