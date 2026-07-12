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
// Bypass removed for security — HMAC signature is always enforced.
const META_SKIP_SIG = false;
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
      // Guarda contra caracteres estranhos no filtro .or() (o entryId vem do payload da Meta,
      // mas defesa em profundidade: só aceita dígitos, que é o formato real de page_id / ig_business_account_id).
      if (!/^\d+$/.test(entryId)) {
        console.log("INSTAGRAM_WEBHOOK_APP_DIAGNOSTIC_SKIPPED", { entryId, reason: "non_numeric_entry_id" });
        continue;
      }

      // Multi-tenant: a mesma página/IG pode estar vinculada a mais de uma empresa.
      // Não usamos .maybeSingle() (quebra com PGRST116) nem .limit(1) (poderia
      // escolher empresa errada). Iteramos por todos os registros compatíveis
      // — o diagnóstico é read-only.
      const { data: pages, error } = await sb
        .from("meta_pages")
        .select("company_id, page_id, page_access_token, ig_business_account_id")
        .or(`page_id.eq.${entryId},ig_business_account_id.eq.${entryId}`);

      if (error) {
        console.error("INSTAGRAM_WEBHOOK_APP_DIAGNOSTIC_DB_ERROR", { entryId, error });
        continue;
      }

      if (!pages || pages.length === 0) {
        console.log("INSTAGRAM_WEBHOOK_APP_DIAGNOSTIC", {
          entryId,
          configuredMetaAppId: META_APP_ID || null,
          matchedMetaPage: false,
          matchedCompanies: 0,
          note: "Nenhum registro em meta_pages combina com esse entryId.",
        });
        continue;
      }

      // Deduplica por (page_id, ig_business_account_id, token) para não consultar
      // a Graph API várias vezes para o mesmo par apenas porque há N tenants.
      const seenPair = new Set<string>();
      const subscribedApps: unknown[] = [];
      const graphErrors: unknown[] = [];
      const perTenant: Array<{ companyId: string; pageId: string | null; igId: string | null }> = [];

      for (const page of pages) {
        const pageId = page?.page_id ? String(page.page_id) : null;
        const igId = page?.ig_business_account_id ? String(page.ig_business_account_id) : null;
        const token = page?.page_access_token ? String(page.page_access_token) : "";
        perTenant.push({ companyId: String(page.company_id), pageId, igId });

        const targets = Array.from(new Set([igId, pageId].filter(Boolean))) as string[];
        for (const target of targets) {
          const key = `${target}::${token.slice(0, 12)}`;
          if (seenPair.has(key)) continue;
          seenPair.add(key);
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
      }

      // Compacta subscribedApps por id para reduzir ruído no log.
      const byId = new Map<string, { id: string; name: string | null; category: string | null; targets: string[] }>();
      for (const app of subscribedApps as Array<{ id: string | null; name: string | null; category: string | null; target: string }>) {
        if (!app?.id) continue;
        const cur = byId.get(app.id);
        if (cur) {
          if (!cur.targets.includes(app.target)) cur.targets.push(app.target);
        } else {
          byId.set(app.id, { id: app.id, name: app.name, category: app.category, targets: [app.target] });
        }
      }
      const signingApps = Array.from(byId.values());

      console.log("INSTAGRAM_WEBHOOK_APP_DIAGNOSTIC", {
        entryId,
        configuredMetaAppId: META_APP_ID || null,
        matchedMetaPage: true,
        matchedCompanies: perTenant.length,
        tenants: perTenant,
        signingApps,
        signingAppIds: signingApps.map((a) => a.id),
        graphErrors,
        note: "Meta não envia app_id no payload do webhook; use signingApps[].id para atualizar META_APP_SECRETS com o secret correto.",
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
    interactionType?: "direct_message" | "comment";
  },
): Promise<{ leadId: string; conversationId: string }> {
  const interactionType = opts.interactionType ?? "direct_message";
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

  // get or create conversation, scoped by interaction_type so DMs and comments stay separated
  const { data: conv } = await sb
    .from("conversations")
    .select("id")
    .eq("company_id", opts.companyId)
    .eq("lead_id", leadId)
    .eq("interaction_type", interactionType)
    .maybeSingle();

  if (conv?.id) return { leadId, conversationId: conv.id as string };

  const { data: newConv, error: convErr } = await sb
    .from("conversations")
    .insert({
      company_id: opts.companyId,
      lead_id: leadId,
      channel: opts.channel,
      interaction_type: interactionType,
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
    at?: string;
  },
) {
  // dedupe by external_id (scoped to conversation to be extra safe)
  if (opts.externalId) {
    const { data: dup } = await sb
      .from("messages")
      .select("id")
      .eq("company_id", opts.companyId)
      .eq("conversation_id", opts.conversationId)
      .eq("external_id", opts.externalId)
      .maybeSingle();
    if (dup?.id) {
      console.log("META_WEBHOOK_MSG_DEDUPED", { externalId: opts.externalId, conversationId: opts.conversationId });
      return;
    }
  } else {
    // Sem mid: nunca inserir placeholder de mídia/empty para evitar duplicação em
    // refresh/sync. Só permite quando há texto real do usuário.
    const t = (opts.text ?? "").trim();
    if (!t || t === "[mídia]") {
      console.log("META_WEBHOOK_MSG_SKIPPED_NO_MID", { subtype: opts.subtype, conversationId: opts.conversationId });
      return;
    }
  }
  const at = opts.at ?? new Date().toISOString();
  await sb.from("messages").insert({
    company_id: opts.companyId,
    conversation_id: opts.conversationId,
    role: "lead",
    text: opts.text,
    at,
    external_id: opts.externalId,
    source: opts.source,
    source_subtype: opts.subtype,
    source_metadata: opts.metadata,
  });
  await sb
    .from("conversations")
    .update({ last_message_at: at, awaiting_reply: true })
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

// Constrói um preview textual curto da mensagem original que foi respondida.
// Usado no inbox para mostrar o "balão citado" acima da resposta (igual WhatsApp).
function buildReplyPreview(
  kind: string,
  text: string,
  meta: Record<string, unknown>,
): string {
  const t = (text ?? "").trim();
  switch (kind) {
    case "image":
      return t && !t.startsWith("[") ? `📷 ${t}` : "📷 Foto";
    case "audio":
      return "🎤 Mensagem de voz";
    case "video":
      return t && !t.startsWith("[") ? `🎬 ${t}` : "🎬 Vídeo";
    case "document": {
      const fn = (meta?.media_filename as string | undefined) ?? "";
      return fn ? `📎 ${fn}` : "📎 Documento";
    }
    case "sticker":
      return "🟢 Sticker";
    case "location":
      return "📍 Localização";
    default:
      return t.length > 120 ? `${t.slice(0, 117)}…` : t || "[mensagem]";
  }
}

// ---------- Media download (WhatsApp) ----------
async function logMedia(
  sb: Sb,
  stage: string,
  ctx: Record<string, unknown>,
  severity: "info" | "error" = "info",
): Promise<void> {
  try {
    await sb.from("error_log").insert({
      source: "whatsapp",
      severity,
      message: `whatsapp.webhook.media:${stage}`,
      company_id: (ctx.company_id as string) ?? null,
      context: { subsource: "whatsapp.webhook.media", stage, ...ctx },
    });
  } catch (e) {
    console.error("META_WEBHOOK_MEDIA_LOG_FAIL", stage, e instanceof Error ? e.message : String(e), ctx);
  }
}

function extFromMime(mime: string): string {
  const m = (mime || "").toLowerCase().split(";")[0].trim();
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr", "audio/wav": "wav",
    "video/mp4": "mp4", "video/3gpp": "3gp", "video/quicktime": "mov",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  };
  if (map[m]) return map[m];
  const sub = m.split("/")[1] ?? "bin";
  return sub.replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
}

async function downloadAndStoreMedia(
  sb: Sb,
  args: {
    companyId: string;
    conversationId: string;
    messageId: string;
    mediaKind: string;
    payload: any;
    accessToken: string;
    waId: string;
    raw: any;
  },
): Promise<void> {
  const { companyId, conversationId, messageId, mediaKind, payload, accessToken } = args;
  const mediaId = payload?.id ? String(payload.id) : "";
  const mimeFromPayload = payload?.mime_type ? String(payload.mime_type) : "";
  const filenameFromPayload = payload?.filename ? String(payload.filename) : "";

  const baseCtx = {
    company_id: companyId,
    conversation_id: conversationId,
    message_id: messageId,
    media_id: mediaId,
    media_kind: mediaKind,
    media_mime: mimeFromPayload,
  };

  await logMedia(sb, "media_detected", baseCtx);

  if (!mediaId) {
    await logMedia(sb, "graph_metadata_no_url", { ...baseCtx, error_message: "missing media id in payload" }, "error");
    return;
  }
  if (!accessToken) {
    await logMedia(sb, "no_access_token", baseCtx, "error");
    return;
  }

  // 1) metadata
  await logMedia(sb, "graph_metadata_fetch", baseCtx);
  let metaResp: Response;
  try {
    metaResp = await fetch(`${GRAPH}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    await logMedia(sb, "graph_metadata", { ...baseCtx, error_message: e instanceof Error ? e.message : String(e) }, "error");
    return;
  }
  const metaBody = await metaResp.text();
  if (!metaResp.ok) {
    await logMedia(sb, "graph_metadata", { ...baseCtx, http_status: metaResp.status, response_body: metaBody.slice(0, 1000) }, "error");
    return;
  }
  let metaJson: any;
  try { metaJson = JSON.parse(metaBody); } catch {
    await logMedia(sb, "graph_metadata", { ...baseCtx, http_status: metaResp.status, response_body: metaBody.slice(0, 500), error_message: "invalid JSON" }, "error");
    return;
  }
  const downloadUrl = metaJson?.url as string | undefined;
  const mime = (metaJson?.mime_type as string | undefined) || mimeFromPayload || "application/octet-stream";
  const sizeFromMeta = typeof metaJson?.file_size === "number" ? metaJson.file_size : null;
  if (!downloadUrl) {
    await logMedia(sb, "graph_metadata_no_url", { ...baseCtx, http_status: metaResp.status, response_body: metaBody.slice(0, 500) }, "error");
    return;
  }

  // 2) binary
  await logMedia(sb, "binary_fetch", { ...baseCtx, media_mime: mime });
  let binResp: Response;
  try {
    binResp = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (e) {
    await logMedia(sb, "binary_download", { ...baseCtx, error_message: e instanceof Error ? e.message : String(e) }, "error");
    return;
  }
  if (!binResp.ok) {
    const bodyText = await binResp.text().catch(() => "");
    await logMedia(sb, "binary_download", { ...baseCtx, http_status: binResp.status, response_body: bodyText.slice(0, 500) }, "error");
    return;
  }
  const buf = new Uint8Array(await binResp.arrayBuffer());
  const size = buf.byteLength;

  // 3) storage upload
  const ext = extFromMime(mime);
  const filename = filenameFromPayload || `${mediaId}.${ext}`;
  const path = `${companyId}/${conversationId}/${messageId}-${mediaId}.${ext}`;
  const { error: upErr } = await sb.storage.from("whatsapp-media").upload(path, buf, {
    contentType: mime,
    upsert: true,
  });
  if (upErr) {
    await logMedia(sb, "storage_upload", { ...baseCtx, error_message: upErr.message }, "error");
    return;
  }

  // 3b) Audio transcription (OpenAI Whisper). Best-effort: any failure is
  //     gravada em source_metadata.ai_media_error e NÃO quebra o webhook.
  //     Não altera WhatsApp, envio, templates, IA Coach, IA de Atendimento,
  //     banco ou UI — apenas enriquece messages.source_metadata + messages.text.
  const aiExtras: Record<string, unknown> = {};
  let transcribedText: string | null = null;
  if (mediaKind === "audio") {
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    console.log("[meta-webhook] audio_transcricao_inicio", {
      message_id: messageId, mime, size, has_key: !!openaiKey,
    });
    if (!openaiKey) {
      aiExtras.ai_media_error = "OPENAI_API_KEY não configurada";
    } else {
      try {
        const audioExt = mime.includes("ogg") ? "ogg"
          : mime.includes("mpeg") ? "mp3"
          : mime.includes("mp4") ? "m4a"
          : mime.includes("wav") ? "wav"
          : mime.includes("webm") ? "webm"
          : mime.includes("aac") ? "aac"
          : "ogg";
        const form = new FormData();
        form.append("file", new Blob([buf], { type: mime || "audio/ogg" }), `audio.${audioExt}`);
        form.append("model", "whisper-1");
        form.append("language", "pt");
        form.append("response_format", "json");
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 25_000);
        let trRes: Response;
        try {
          trRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${openaiKey}` },
            body: form,
            signal: ctrl.signal,
          });
        } finally { clearTimeout(t); }
        if (!trRes.ok) {
          const body = await trRes.text().catch(() => "");
          throw new Error(`Whisper HTTP ${trRes.status}: ${body.slice(0, 200)}`);
        }
        const j = await trRes.json() as { text?: string };
        const txt = (j.text ?? "").trim();
        if (!txt) {
          aiExtras.ai_media_error = "Transcrição vazia retornada pelo Whisper";
        } else {
          transcribedText = txt;
          aiExtras.transcription_text = txt;
          aiExtras.transcription_model = "whisper-1";
          aiExtras.transcription_at = new Date().toISOString();
          console.log("[meta-webhook] audio_transcricao_ok", {
            message_id: messageId, chars: txt.length,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[meta-webhook] audio_transcricao_erro", { message_id: messageId, error: msg });
        aiExtras.ai_media_error = msg.slice(0, 500);
      }
    }
  }

  // 4) update message metadata
  const { data: current } = await sb.from("messages").select("source_metadata").eq("id", messageId).maybeSingle();
  const merged = {
    ...(current?.source_metadata ?? {}),
    media_path: path,
    media_kind: mediaKind,
    media_mime: mime,
    media_filename: filename,
    media_size: sizeFromMeta ?? size,
    media_downloaded_at: new Date().toISOString(),
    ...aiExtras,
  };
  const updatePayload: Record<string, unknown> = { source_metadata: merged };
  if (transcribedText) updatePayload.text = transcribedText;
  const { error: updErr } = await sb.from("messages").update(updatePayload).eq("id", messageId);
  if (updErr) {
    await logMedia(sb, "database_update", { ...baseCtx, error_message: updErr.message, media_path: path }, "error");
    return;
  }

  await logMedia(sb, "media_success", { ...baseCtx, media_mime: mime, media_path: path, media_size: sizeFromMeta ?? size });
}

async function handleWhatsAppEntry(sb: Sb, entry: any): Promise<void> {
  const changes = Array.isArray(entry?.changes) ? entry.changes : [];
  const wabaIdFromEntry = entry?.id ? String(entry.id) : null;
  for (const change of changes) {
    if (change?.field !== "messages") continue;
    const value = change.value ?? {};
    const phoneNumberId = value?.metadata?.phone_number_id;
    const displayPhoneNumber = value?.metadata?.display_phone_number ?? null;
    if (!phoneNumberId) {
      console.log("META_WEBHOOK_WA_NO_PHONE_ID");
      continue;
    }

    const { data: integration } = await sb
      .from("integrations")
      .select("id, company_id, access_token")
      .eq("channel", "whatsapp")
      .eq("external_account_id", phoneNumberId)
      .eq("active", true)
      .maybeSingle();

    if (!integration) {
      console.log(
        "META_WEBHOOK_WA_UNMAPPED_NUMBER — mensagem recebida de número WhatsApp não vinculado à empresa",
        { phone_number_id: phoneNumberId, waba_id: wabaIdFromEntry, display_phone_number: displayPhoneNumber },
      );
      // Registra o evento para o painel administrativo. Não bloqueia o
      // webhook em caso de erro — apenas loga.
      try {
        const incoming = Array.isArray(value?.messages) ? value.messages : [];
        const contactsList = Array.isArray(value?.contacts) ? value.contacts : [];
        const firstMsg = incoming[0] ?? null;
        const firstContact = contactsList[0] ?? null;
        const preview = firstMsg ? extractWaText(firstMsg).slice(0, 280) : null;
        await sb.from("whatsapp_unmapped_events").insert({
          phone_number_id: String(phoneNumberId),
          waba_id: wabaIdFromEntry,
          display_phone_number: displayPhoneNumber,
          from_wa_id: firstMsg?.from ? String(firstMsg.from) : null,
          contact_name: firstContact?.profile?.name ?? null,
          message_preview: preview,
          payload: { value, entry_id: wabaIdFromEntry },
        });
      } catch (e) {
        console.log("META_WEBHOOK_WA_UNMAPPED_LOG_ERROR", String(e));
      }
      continue;
    }

    const companyId = integration.company_id as string;
    const integrationId = integration.id as string;
    const accessToken = (integration as any).access_token ? String((integration as any).access_token) : "";
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
            // 3a) reply context (WhatsApp "responder a mensagem")
            // Meta envia m.context = { from, id } quando o usuário responde
            // a uma mensagem. Buscamos a mensagem original para enriquecer
            // o metadata com um preview clicável.
            let replyTo: Record<string, unknown> | null = null;
            const ctxId = m?.context?.id ? String(m.context.id) : null;
            if (ctxId) {
              try {
                const { data: orig } = await sb
                  .from("messages")
                  .select("id, role, text, source_subtype, source_metadata")
                  .eq("integration_id", integrationId)
                  .eq("external_id", ctxId)
                  .maybeSingle();
                if (orig) {
                  const om = (orig.source_metadata ?? {}) as Record<string, unknown>;
                  const kind = (orig.source_subtype as string | null) ?? "text";
                  const preview = buildReplyPreview(kind, orig.text ?? "", om);
                  replyTo = {
                    message_id: orig.id,
                    external_id: ctxId,
                    role: orig.role,
                    type: kind,
                    preview,
                    media_path: (om.media_path as string | undefined) ?? null,
                    media_mime: (om.media_mime as string | undefined) ?? null,
                  };
                } else {
                  replyTo = { external_id: ctxId, message_id: null, type: "unknown", preview: null };
                }
              } catch (e) {
                console.error("META_WEBHOOK_REPLY_LOOKUP_FAIL", e instanceof Error ? e.message : String(e));
              }
            }

            const baseMeta: Record<string, unknown> = { wa_id: waId, raw: m };
            if (replyTo) baseMeta.reply_to = replyTo;

            const { data: inserted } = await sb.from("messages").insert({
              company_id: companyId,
              conversation_id: conversationId,
              role: "lead",
              text: msgText,
              at,
              external_id: externalId,
              integration_id: integrationId,
              source: "whatsapp",
              source_subtype: m?.type ?? "text",
              source_metadata: baseMeta,
            }).select("id").single();

            // 3b) media download (best-effort, must not break webhook)
            const messageId = inserted?.id as string | undefined;
            const mediaKind = m?.type as string | undefined;
            if (messageId && mediaKind && ["image", "audio", "video", "document", "sticker"].includes(mediaKind)) {
              try {
                await downloadAndStoreMedia(sb, {
                  companyId,
                  conversationId,
                  messageId,
                  mediaKind,
                  payload: m?.[mediaKind] ?? {},
                  accessToken,
                  waId,
                  raw: m,
                });
              } catch (e) {
                console.error("META_WEBHOOK_MEDIA_UNCAUGHT", e instanceof Error ? e.message : String(e));
              }
            }
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

    // ---- statuses[]: sent / delivered / read / failed ----
    const statuses = Array.isArray((value as any).statuses) ? (value as any).statuses : [];
    for (const st of statuses) {
      try {
        const externalId = st?.id ? String(st.id) : null;
        if (!externalId) continue;
        const status = String(st?.status ?? "").toLowerCase();
        const tsRaw = st?.timestamp ? Number(st.timestamp) : NaN;
        const statusAt = Number.isFinite(tsRaw)
          ? new Date(tsRaw * 1000).toISOString()
          : new Date().toISOString();
        const errArr = Array.isArray(st?.errors) ? st.errors : [];
        const err0 = errArr[0] ?? null;
        const errCode = err0?.code != null ? String(err0.code) : null;
        const errTitle = err0?.title ?? null;
        const errMessage = err0?.message ?? errTitle ?? null;
        const errDetails = err0?.error_data ?? err0 ?? null;

        const { data: msg } = await sb
          .from("messages")
          .select("id, conversation_id, source_subtype, delivery_status")
          .eq("integration_id", integrationId)
          .eq("external_id", externalId)
          .maybeSingle();

        if (msg?.source_subtype === "audio") {
          console.log("[WHATSAPP STATUS AUDIO]", {
            external_id: externalId,
            message_id: msg?.id ?? null,
            conversation_id: msg?.conversation_id ?? null,
            status,
            status_at: statusAt,
            recipient_id: st?.recipient_id ?? null,
            conversation: st?.conversation ?? null,
            pricing: st?.pricing ?? null,
            error_code: errCode,
            error_title: errTitle,
            error_message: errMessage,
            error_details: errDetails,
            raw: st,
          });
        }

        console.log("META_WEBHOOK_WA_STATUS", {
          external_id: externalId,
          status,
          message_id: msg?.id ?? null,
          subtype: msg?.source_subtype ?? null,
          error_code: errCode,
          error_message: errMessage,
        });

        if (!msg?.id) continue;

        // ordem: sent < delivered < read < failed; nunca rebaixa
        const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };
        const currentRank = rank[msg.delivery_status ?? ""] ?? 0;
        const incomingRank = rank[status] ?? 0;
        if (incomingRank === 0 || incomingRank < currentRank) continue;

        await sb
          .from("messages")
          .update({
            delivery_status: status,
            delivery_error_code: errCode,
            delivery_error_message: errMessage,
            delivery_error_details: errDetails as any,
            status_updated_at: statusAt,
          })
          .eq("id", msg.id);
      } catch (e) {
        console.error("META_WEBHOOK_WA_STATUS_ERROR", e instanceof Error ? e.message : String(e));
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
      skipping: false,
    });
    if (origin.object === "instagram") {
      await logInstagramAppDiagnostics(sb, origin.entryIds);
    }
    return text("invalid signature", 401);
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
    // IMPORTANTE: a mesma Página/IG pode estar conectada a MAIS DE UMA empresa
    // (multi-tenant). Usamos .select() comum e iteramos — .single()/.maybeSingle()
    // quebrava com PGRST116 quando havia 2+ linhas e o evento era descartado.
    const { data: pages, error: pagesErr } = await sb
      .from("meta_pages")
      .select("company_id, page_id, page_access_token, ig_business_account_id")
      .or(`page_id.eq.${entryId},ig_business_account_id.eq.${entryId}`);

    if (pagesErr) {
      console.error("META_WEBHOOK_PAGE_LOOKUP_ERROR", { entryId, error: pagesErr });
      continue;
    }
    if (!pages || pages.length === 0) {
      console.log("META_WEBHOOK_PAGE_NOT_FOUND", entryId);
      continue;
    }
    console.log("META_PAGE_SUBSCRIPTIONS", {
      entryId,
      matchedCompanies: pages.length,
      companyIds: pages.map((p: any) => p.company_id),
    });

  for (const page of pages) {
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

        // Ignora echoes (mensagens enviadas pela própria página/IG ecoadas pela Meta).
        if (m?.message?.is_echo === true || m?.message?.app_id || m?.read || m?.delivery) {
          console.log("META_WEBHOOK_EVENT_IGNORED", {
            reason: "echo_or_status",
            isEcho: !!m?.message?.is_echo,
            hasRead: !!m?.read,
            hasDelivery: !!m?.delivery,
            mid: m?.message?.mid ?? null,
            companyId,
          });
          continue;
        }

        const hasText = typeof m?.message?.text === "string" && m.message.text.trim().length > 0;
        const hasAttachment = Array.isArray(m?.message?.attachments) && m.message.attachments.length > 0;
        const text = hasText
          ? m.message.text
          : hasAttachment
            ? (m.message.attachments[0]?.payload?.url ?? "[mídia]")
            : "[mídia]";
        const mid = m?.message?.mid ?? null;
        const tsMs = typeof m?.timestamp === "number" ? m.timestamp : Date.now();
        const atIso = new Date(tsMs).toISOString();
        const source: "instagram" | "messenger" = isInstagram ? "instagram" : "messenger";
        const channel: "instagram" | "facebook" = isInstagram ? "instagram" : "facebook";

        // Sem mid e sem texto real → não cria placeholder (evita duplicar [mídia] em sync).
        if (!mid && !hasText) {
          console.log("META_WEBHOOK_EVENT_IGNORED", {
            reason: "no_mid_no_text",
            senderId,
            source,
            companyId,
          });
          continue;
        }

        console.log("META_MESSAGE_RECEIVED", {
          source,
          senderId,
          recipientId,
          mid,
          companyId,
          pageId,
          igAccountId: page.ig_business_account_id,
          textPreview: String(text).slice(0, 80),
        });

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
            at: atIso,
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
            interactionType: "comment",
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
            interactionType: "comment",
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
  } // end for (const page of pages)
  }

  return text("ok", 200);
});
