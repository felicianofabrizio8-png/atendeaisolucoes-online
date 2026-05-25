// Edge Function: meta-webhook  (Instagram / Facebook / Messenger)
// PUBLIC — verify_jwt=false (config.toml).
//
// GET:  verificação do webhook Meta (hub.verify_token vs META_VERIFY_TOKEN).
// POST: recebe eventos. Valida assinatura X-Hub-Signature-256 (HMAC SHA-256 com META_APP_SECRET).
//       Para cada evento, faz upsert de lead + conversation + insere message.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const META_APP_SECRETS_EXTRA = Deno.env.get("META_APP_SECRETS") ?? ""; // comma-separated fallback secrets
const META_APP_ID = Deno.env.get("META_APP_ID") ?? Deno.env.get("VITE_META_APP_ID") ?? "";
const META_SKIP_SIG = Deno.env.get("META_SKIP_SIG") === "1"; // emergency bypass
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.facebook.com/v21.0";

function text(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

type SecretCandidate = {
  appId: string | null;
  label: string;
  secret: string;
  source: string;
};

type SignatureResult = {
  ok: boolean;
  expectedPreview: string;
  secretsTried: number;
  matched: Omit<SecretCandidate, "secret"> & { secretLen: number } | null;
  candidates: Array<Omit<SecretCandidate, "secret"> & { secretLen: number; expectedPrefix: string }>;
};

function parseSecretToken(raw: string, index: number): SecretCandidate | null {
  const token = raw.trim().replace(/^['"]|['"]$/g, "");
  if (!token) return null;

  let label = `META_APP_SECRETS[${index}]`;
  let appId: string | null = null;
  let secret = token;
  const hexSecret = token.match(/[a-f0-9]{32}/i)?.[0];
  if (hexSecret) {
    secret = hexSecret;
    const beforeSecret = token.slice(0, token.indexOf(hexSecret)).replace(/[\s:=-]+$/g, "").trim();
    if (beforeSecret) label = beforeSecret;
    const idMatch = token.match(/\b\d{6,}\b/);
    if (idMatch) appId = idMatch[0];
  }

  const eq = token.indexOf("=");
  const colon = token.indexOf(":");
  const separator = eq > 0 ? eq : colon > 0 ? colon : -1;
  if (!hexSecret && separator > 0) {
    const left = token.slice(0, separator).trim();
    const right = token.slice(separator + 1).trim();
    if (right.length >= 16) {
      secret = right.replace(/^['"]|['"]$/g, "");
      appId = /^\d{6,}$/.test(left) ? left : null;
      label = left || label;
    }
  }

  return { appId, label, secret, source: "META_APP_SECRETS" };
}

function getAllSecretCandidates(): SecretCandidate[] {
  const candidates: SecretCandidate[] = [];
  if (META_APP_SECRET.trim()) {
    candidates.push({
      appId: META_APP_ID || null,
      label: META_APP_ID ? `META_APP_SECRET:${META_APP_ID}` : "META_APP_SECRET",
      secret: META_APP_SECRET.trim(),
      source: "META_APP_SECRET",
    });
  }

  const extra = META_APP_SECRETS_EXTRA.trim();
  if (extra.startsWith("{") || extra.startsWith("[")) {
    try {
      const parsed = JSON.parse(extra);
      if (Array.isArray(parsed)) {
        parsed.forEach((item, index) => {
          if (typeof item === "string") {
            const candidate = parseSecretToken(item, index);
            if (candidate) candidates.push({ ...candidate, source: "META_APP_SECRETS_JSON" });
            return;
          }
          const secret = String(item?.secret ?? item?.app_secret ?? "").trim();
          if (!secret) return;
          const normalizedSecret = secret.match(/[a-f0-9]{32}/i)?.[0] ?? secret;
          candidates.push({
            appId: item?.app_id || item?.appId ? String(item.app_id ?? item.appId) : null,
            label: String(item?.name ?? item?.label ?? item?.app_id ?? item?.appId ?? `META_APP_SECRETS[${index}]`),
            secret: normalizedSecret,
            source: "META_APP_SECRETS_JSON",
          });
        });
      } else if (parsed && typeof parsed === "object") {
        Object.entries(parsed).forEach(([appId, secret]) => {
          if (typeof secret === "string" && secret.trim()) {
            candidates.push({ appId, label: appId, secret: secret.trim(), source: "META_APP_SECRETS_JSON" });
          }
        });
      }
    } catch (e) {
      console.error("META_WEBHOOK_SECRET_PARSE_ERROR", e instanceof Error ? e.message : String(e));
    }
  } else {
    extra
      .split(/[\n,;]/)
      .map((s, i) => parseSecretToken(s, i))
      .filter((s): s is SecretCandidate => !!s)
      .forEach((s) => candidates.push(s));
  }

  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = c.secret;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function hmacHex(secret: string, bodyBytes: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, bodyBytes);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifySignature(rawBodyBytes: Uint8Array, signature: string | null): Promise<SignatureResult> {
  const candidates = getAllSecretCandidates();
  if (!signature || !signature.startsWith("sha256=")) {
    return { ok: false, expectedPreview: "", secretsTried: candidates.length, matched: null, candidates: [] };
  }
  const provided = signature.slice(7);
  let firstExpected = "";
  const diagnostics: SignatureResult["candidates"] = [];
  for (const c of candidates) {
    const expected = await hmacHex(c.secret, rawBodyBytes);
    if (!firstExpected) firstExpected = expected;
    diagnostics.push({ appId: c.appId, label: c.label, source: c.source, secretLen: c.secret.length, expectedPrefix: expected.slice(0, 12) });
    if (provided.length === expected.length) {
      let diff = 0;
      for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
      if (diff === 0) {
        return {
          ok: true,
          expectedPreview: expected.slice(0, 12),
          secretsTried: candidates.length,
          matched: { appId: c.appId, label: c.label, source: c.source, secretLen: c.secret.length },
          candidates: diagnostics,
        };
      }
    }
  }
  return { ok: false, expectedPreview: firstExpected.slice(0, 12), secretsTried: candidates.length, matched: null, candidates: diagnostics };
}

function extractWebhookOrigin(rawBody: string) {
  try {
    const parsed = JSON.parse(rawBody);
    const entries = Array.isArray(parsed?.entry) ? parsed.entry : [];
    return {
      object: parsed?.object ?? null,
      entryIds: entries.map((e: any) => String(e?.id ?? "")).filter(Boolean),
      fields: entries.flatMap((e: any) => (Array.isArray(e?.changes) ? e.changes.map((c: any) => c?.field).filter(Boolean) : [])),
      hasMessaging: entries.some((e: any) => Array.isArray(e?.messaging) && e.messaging.length > 0),
    };
  } catch {
    return { object: null, entryIds: [], fields: [], hasMessaging: false };
  }
}

function getHeaderDiagnostics(req: Request) {
  return {
    userAgent: req.headers.get("user-agent"),
    host: req.headers.get("host"),
    fbTraceId: req.headers.get("x-fb-trace-id"),
    fbRev: req.headers.get("x-fb-rev"),
    fbRequestId: req.headers.get("x-fb-request-id"),
    signaturePrefix: req.headers.get("x-hub-signature-256")?.slice(0, 19) ?? null,
  };
}

async function logInstagramAppDiagnostics(sb: Sb, entryIds: string[]) {
  for (const entryId of entryIds) {
    try {
      const { data: page, error } = await sb
        .from("meta_pages")
        .select("company_id, page_id, page_access_token, ig_business_account_id")
        .or(`page_id.eq.${entryId},ig_business_account_id.eq.${entryId}`)
        .maybeSingle();

      if (error) {
        console.error("INSTAGRAM_WEBHOOK_APP_DIAGNOSTIC_DB_ERROR", { entryId, error });
        continue;
      }

      const igBusinessAccountId = page?.ig_business_account_id ? String(page.ig_business_account_id) : null;
      const pageId = page?.page_id ? String(page.page_id) : null;
      const subscribedApps: unknown[] = [];
      const graphErrors: unknown[] = [];
      const token = page?.page_access_token ? String(page.page_access_token) : "";
      const targets = Array.from(new Set([igBusinessAccountId, pageId].filter(Boolean))) as string[];

      for (const target of targets) {
        try {
          const r = await fetch(`${GRAPH}/${target}/subscribed_apps?access_token=${encodeURIComponent(token)}`);
          const j = await r.json().catch(() => null);
          if (r.ok && Array.isArray(j?.data)) {
            subscribedApps.push(...j.data.map((app: any) => ({ id: app?.id ?? null, name: app?.name ?? null, category: app?.category ?? null, target })));
          } else {
            graphErrors.push({ target, status: r.status, body: j });
          }
        } catch (e) {
          graphErrors.push({ target, error: e instanceof Error ? e.message : String(e) });
        }
      }

      console.log("INSTAGRAM_WEBHOOK_APP_DIAGNOSTIC", {
        entryId,
        configuredMetaAppId: META_APP_ID || null,
        matchedMetaPage: !!page,
        pageId,
        igBusinessAccountId,
        subscribedApps,
        graphErrors,
        note: "Meta não envia app_id no payload do webhook; o app assinante é confirmado quando um App Secret produz o mesmo x-hub-signature-256.",
      });
    } catch (e) {
      console.error("INSTAGRAM_WEBHOOK_APP_DIAGNOSTIC_ERROR", { entryId, error: e instanceof Error ? e.message : String(e) });
    }
  }
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

// ---------- WhatsApp Cloud API ----------
function extractWaText(m: any): string {
  if (m?.type === "text" && m?.text?.body) return m.text.body;
  if (m?.type === "button" && m?.button?.text) return m.button.text;
  if (m?.type === "interactive") {
    const i = m.interactive;
    if (i?.button_reply?.title) return i.button_reply.title;
    if (i?.list_reply?.title) return i.list_reply.title;
  }
  if (m?.type === "image") return "[imagem]";
  if (m?.type === "audio") return "[áudio]";
  if (m?.type === "video") return "[vídeo]";
  if (m?.type === "document") return "[documento]";
  if (m?.type === "location") return "[localização]";
  return `[${m?.type ?? "mensagem"}]`;
}

async function handleWhatsAppEntry(sb: Sb, entry: any): Promise<void> {
  const changes = Array.isArray(entry?.changes) ? entry.changes : [];
  for (const change of changes) {
    if (change?.field !== "messages") continue;
    const value = change.value ?? {};
    const phoneNumberId = value?.metadata?.phone_number_id;
    if (!phoneNumberId) {
      console.log("META_WEBHOOK_WA_NO_PHONE_ID");
      continue;
    }

    const { data: integration } = await sb
      .from("integrations")
      .select("id, company_id")
      .eq("channel", "whatsapp")
      .eq("external_account_id", phoneNumberId)
      .eq("active", true)
      .maybeSingle();

    if (!integration) {
      console.log("META_WEBHOOK_WA_INTEGRATION_NOT_FOUND", phoneNumberId);
      continue;
    }

    const companyId = integration.company_id as string;
    const integrationId = integration.id as string;
    const messages = Array.isArray(value.messages) ? value.messages : [];
    const contactsById = new Map<string, any>();
    for (const c of value.contacts ?? []) contactsById.set(c.wa_id, c);

    for (const m of messages) {
      try {
        const waId = String(m?.from ?? "");
        if (!waId) continue;
        const contact = contactsById.get(waId);
        const leadName = contact?.profile?.name ?? waId;
        const at = m?.timestamp
          ? new Date(Number(m.timestamp) * 1000).toISOString()
          : new Date().toISOString();
        const msgText = extractWaText(m);

        // 1) lead
        let leadId: string;
        const { data: existingLead } = await sb
          .from("leads")
          .select("id")
          .eq("company_id", companyId)
          .eq("integration_id", integrationId)
          .eq("external_id", waId)
          .maybeSingle();

        if (existingLead?.id) {
          leadId = existingLead.id as string;
          await sb.from("leads").update({ name: leadName }).eq("id", leadId);
        } else {
          const { data: byPhone } = await sb
            .from("leads")
            .select("id")
            .eq("company_id", companyId)
            .eq("phone", waId)
            .maybeSingle();
          if (byPhone?.id) {
            leadId = byPhone.id as string;
            await sb
              .from("leads")
              .update({ integration_id: integrationId, external_id: waId, name: leadName })
              .eq("id", leadId);
          } else {
            const { data: created, error: leadErr } = await sb
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
            if (leadErr) throw leadErr;
            leadId = created!.id as string;
          }
        }

        // 2) conversation
        let conversationId: string;
        const { data: existingConv } = await sb
          .from("conversations")
          .select("id")
          .eq("company_id", companyId)
          .eq("lead_id", leadId)
          .eq("channel", "whatsapp")
          .maybeSingle();
        if (existingConv?.id) {
          conversationId = existingConv.id as string;
        } else {
          const { data: newConv, error: convErr } = await sb
            .from("conversations")
            .insert({
              company_id: companyId,
              lead_id: leadId,
              channel: "whatsapp",
              last_message_at: at,
              unread: 1,
              awaiting_reply: true,
            })
            .select("id")
            .single();
          if (convErr) throw convErr;
          conversationId = newConv!.id as string;
        }

        // 3) message (idempotente)
        const externalId = m?.id ? String(m.id) : null;
        if (externalId) {
          const { data: dup } = await sb
            .from("messages")
            .select("id")
            .eq("integration_id", integrationId)
            .eq("external_id", externalId)
            .maybeSingle();
          if (!dup?.id) {
            await sb.from("messages").insert({
              company_id: companyId,
              conversation_id: conversationId,
              role: "lead",
              text: msgText,
              at,
              external_id: externalId,
              integration_id: integrationId,
              source: "whatsapp",
              source_subtype: m?.type ?? "text",
              source_metadata: { wa_id: waId, raw: m },
            });
          }
        }

        // 4) atualiza conversa
        await sb
          .from("conversations")
          .update({ last_message_at: at, awaiting_reply: true })
          .eq("id", conversationId);

        // 5) espelha em whatsapp_messages (direction='in')
        await sb.from("whatsapp_messages").insert({
          company_id: companyId,
          numero: waId,
          mensagem: msgText,
          direction: "in",
          origem: "meta_cloud_api",
          push_name: contact?.profile?.name ?? null,
          whatsapp_jid: `${waId}@s.whatsapp.net`,
        });

        console.log("META_WEBHOOK_WA_SAVED", { waId, conversationId, externalId });
      } catch (e) {
        console.error("META_WEBHOOK_WA_MSG_ERROR", e instanceof Error ? e.message : String(e));
      }
    }

    await sb
      .from("integrations")
      .update({ last_synced_at: new Date().toISOString(), last_error: null })
      .eq("id", integrationId);
  }
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

  const rawBodyBytes = new Uint8Array(await req.arrayBuffer());
  const raw = new TextDecoder().decode(rawBodyBytes);
  const origin = extractWebhookOrigin(raw);
  console.log("META_WEBHOOK_RAW_BODY", raw.slice(0, 4000));
  console.log("META_WEBHOOK_ORIGIN", {
    ...origin,
    headers: getHeaderDiagnostics(req),
    configuredMetaAppId: META_APP_ID || null,
  });

  const sig = req.headers.get("x-hub-signature-256");
  const sigResult = await verifySignature(rawBodyBytes, sig);
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (!sigResult.ok) {
    console.log("META_WEBHOOK_BAD_SIGNATURE", {
      sigReceivedPrefix: sig?.slice(7, 19) ?? null,
      sigExpectedPrefix: sigResult.expectedPreview,
      secretsTried: sigResult.secretsTried,
      bodyLen: rawBodyBytes.byteLength,
      origin,
      candidates: sigResult.candidates,
      skipping: META_SKIP_SIG,
    });
    if (origin.object === "instagram") {
      await logInstagramAppDiagnostics(sb, origin.entryIds);
    }
    if (!META_SKIP_SIG) return text("invalid signature", 401);
  } else {
    console.log("META_WEBHOOK_SIG_OK", {
      secretsTried: sigResult.secretsTried,
      matchedAppId: sigResult.matched?.appId ?? null,
      matchedLabel: sigResult.matched?.label ?? null,
      matchedSource: sigResult.matched?.source ?? null,
      origin,
    });
  }

  if (origin.object === "instagram") {
    await logInstagramAppDiagnostics(sb, origin.entryIds);
  }

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

  console.log("META_WEBHOOK_INCOMING", { object, raw: raw.slice(0, 2000) });

  for (const entry of entries) {
    // Identify the page/account this entry belongs to.
    const entryId = String(entry?.id ?? "");
    if (!entryId) continue;

    // -------- WhatsApp Cloud API --------
    if (object === "whatsapp_business_account") {
      try {
        await handleWhatsAppEntry(sb, entry);
      } catch (e) {
        console.error("META_WEBHOOK_WA_ERROR", e instanceof Error ? e.message : String(e));
      }
      continue;
    }

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
        const tsMs = typeof m?.timestamp === "number" ? m.timestamp : Date.now();
        const source: "instagram" | "messenger" = isInstagram ? "instagram" : "messenger";
        const channel: "instagram" | "facebook" = isInstagram ? "instagram" : "facebook";

        if (isInstagram) {
          console.log("INSTAGRAM_WEBHOOK_RECEIVED", {
            senderId,
            recipientId,
            igAccountId: page.ig_business_account_id,
            mid,
            ts: tsMs,
            textPreview: String(text).slice(0, 80),
          });
        }

        const name = await fetchPsidName(senderId, pageToken);

        try {
          const { conversationId, leadId } = await upsertLeadAndConversation(sb, {
            companyId,
            source,
            senderId,
            pageId,
            name,
            channel,
          });

          if (isInstagram) {
            console.log("INSTAGRAM_CONVERSATION_UPDATED", { conversationId, leadId, senderId });
          }

          await insertMessage(sb, {
            companyId,
            conversationId,
            text: String(text),
            externalId: mid ? String(mid) : null,
            source,
            subtype: "dm",
            metadata: { recipient_id: recipientId, username: name, ts: tsMs, raw: m },
          });

          if (isInstagram) {
            console.log("INSTAGRAM_MESSAGE_SAVED", { conversationId, mid, senderId });
            console.log("INSTAGRAM_REALTIME_SENT", { conversationId, companyId });
          }
        } catch (dbErr) {
          console.error("INSTAGRAM_DB_ERROR", {
            senderId,
            igAccountId: page.ig_business_account_id,
            error: dbErr instanceof Error ? dbErr.message : String(dbErr),
            metaPayload: m,
          });
          throw dbErr;
        }
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
