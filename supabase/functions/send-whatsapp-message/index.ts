// Edge Function: send-whatsapp-message  (Evolution API)
// - Exige JWT do usuário (verify_jwt=true em config.toml).
// - Resolve a empresa do usuário pelo profile.
// - Rate-limit best-effort por usuário.
// - Envia via Evolution API: POST {EVOLUTION_API_URL}/message/sendText/{instance}
// - Persiste em whatsapp_messages com direction="out".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------- rate limit (best-effort) ----------
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, number[]>();
function rateLimit(userId: string): boolean {
  const now = Date.now();
  const arr = (rateBuckets.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (arr.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(userId, arr);
    return false;
  }
  arr.push(now);
  rateBuckets.set(userId, arr);
  return true;
}

const PHONE_RE = /^[0-9+\-\s()]{6,32}$/;
const JID_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/;
const MAX_NUMBER_LEN = 128;
const MAX_MESSAGE_LEN = 4000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!accessToken) return json({ ok: false, error: "unauthorized" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRes, error: userErr } = await supabase.auth.getUser(accessToken);
  if (userErr || !userRes.user) return json({ ok: false, error: "invalid session" }, 401);
  const userId = userRes.user.id;

  if (!rateLimit(userId)) return json({ ok: false, error: "rate limit exceeded" }, 429);

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  const companyId = profile?.company_id;
  if (!companyId) return json({ ok: false, error: "profile without company" }, 403);

  let payload: {
    number?: unknown;
    message?: unknown;
    whatsapp_jid?: unknown;
    contactName?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  const number = typeof payload.number === "string" ? payload.number.trim() : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  const payloadJid = typeof payload.whatsapp_jid === "string" ? payload.whatsapp_jid.trim() : "";

  if (
    !number ||
    number.length > MAX_NUMBER_LEN ||
    (!PHONE_RE.test(number) && !JID_RE.test(number))
  ) {
    return json({ ok: false, error: "invalid number" }, 400);
  }
  if (!message || message.length > MAX_MESSAGE_LEN) {
    return json({ ok: false, error: "invalid message" }, 400);
  }

  // ---------- Evolution API config ----------
  const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL");
  const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY");
  const EVOLUTION_INSTANCE = Deno.env.get("EVOLUTION_INSTANCE_NAME");
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE) {
    return json({ ok: false, error: "Evolution API não configurada" }, 500);
  }
  const baseUrl = EVOLUTION_API_URL.replace(/\/+$/, "");

  // Normalização: extrair dígitos do number ou do payloadJid (caso seja JID).
  const originalJid = JID_RE.test(number) ? number : JID_RE.test(payloadJid) ? payloadJid : "";
  console.log("NUMERO_ORIGINAL", { number, payloadJid });

  let rawDigits = "";
  if (JID_RE.test(number)) {
    const [local, domain] = number.split("@");
    const d = (domain ?? "").toLowerCase();
    if (d === "g.us") {
      return json({ ok: false, error: "envio para grupo não suportado" }, 400);
    }
    rawDigits = (local ?? "").replace(/\D/g, "");
    // Se for @lid e houver payloadJid @s.whatsapp.net, preferir esse número real
    if (d === "lid" && JID_RE.test(payloadJid)) {
      const [pl, pd] = payloadJid.split("@");
      if ((pd ?? "").toLowerCase() === "s.whatsapp.net") {
        rawDigits = (pl ?? "").replace(/\D/g, "");
      }
    }
  } else {
    rawDigits = number.replace(/\D/g, "");
  }

  if (!rawDigits || rawDigits.length < 8 || rawDigits.length > 15) {
    return json({ ok: false, error: "invalid number" }, 400);
  }

  // Garantir prefixo 55 (Brasil)
  const evoNumber = rawDigits.startsWith("55") ? rawDigits : `55${rawDigits}`;
  const jidFinal = `${evoNumber}@s.whatsapp.net`;
  console.log("NUMERO_NORMALIZADO", evoNumber);
  console.log("JID_FINAL", jidFinal);

  const target = `${baseUrl}/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCE)}`;
  const evoPayload = {
    number: jidFinal,
    text: message,
    options: { delay: 0, presence: "composing" },
  };
  console.log("PAYLOAD_EVOLUTION", evoPayload);
  console.log("SEND_FINAL_TARGET", {
    userId,
    companyId,
    target,
    evoNumber,
    originalJid,
    messageLen: message.length,
  });
  console.log("EDGE_EVOLUTION_URL", target);
  console.log("EDGE_EVOLUTION_PAYLOAD", evoPayload);

  let sendOk = false;
  let sendError: string | null = null;
  let messageId: string | null = null;

  try {
    const res = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: EVOLUTION_API_KEY,
      },
      body: JSON.stringify(evoPayload),
    });
    const txt = await res.text();
    console.log("EDGE_EVOLUTION_RESPONSE_STATUS", res.status);
    console.log("EDGE_EVOLUTION_RESPONSE_BODY", txt.slice(0, 1000));
    console.log("EVOLUTION_RESPONSE", {
      status: res.status,
      ok: res.ok,
      body: txt.slice(0, 500),
    });

    let parsed:
      | { key?: { id?: string }; message?: unknown; messageId?: string; error?: unknown; response?: { message?: unknown } }
      | null = null;
    try {
      parsed = JSON.parse(txt);
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      const evoErr =
        (parsed && typeof parsed.error === "string" && parsed.error) ||
        (parsed?.response && typeof parsed.response.message === "string"
          ? (parsed.response.message as string)
          : "") ||
        txt.slice(0, 300);
      sendError = `Evolution ${res.status}: ${evoErr}`;
    } else {
      const id = parsed?.key?.id ?? parsed?.messageId ?? null;
      const hasMessage = parsed?.message != null;
      if (!id && !hasMessage) {
        sendError = `Evolution retornou resposta inválida: ${txt.slice(0, 200)}`;
      } else {
        sendOk = true;
        messageId = id ?? null;
      }
    }
  } catch (e) {
    sendError = e instanceof Error ? e.message : "network error";
    console.error("[send-whatsapp-message] network failure", { err: sendError });
  }

  if (!sendOk) {
    return json({ ok: false, error: sendError ?? "send failed" }, 502);
  }

  const { error: insertErr } = await supabase.from("whatsapp_messages").insert({
    company_id: companyId,
    numero: evoNumber,
    mensagem: message,
    direction: "out",
    origem: "evolution",
    ...(originalJid ? { whatsapp_jid: originalJid } : {}),
  });
  if (insertErr) {
    console.error("[send-whatsapp-message] insert failed", { err: insertErr.message });
    return json({ ok: true, messageId, warning: "message sent but not logged" });
  }

  return json({ ok: true, messageId });
});
