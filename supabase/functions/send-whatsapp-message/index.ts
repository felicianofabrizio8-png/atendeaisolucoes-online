// Edge Function: send-whatsapp-message
// - Exige usuário autenticado (verify_jwt=true em config.toml).
// - Valida número/mensagem (formato e tamanho).
// - Resolve a empresa do usuário pelo profile (não confia em headers).
// - Rate limit simples por usuário (em memória da instância).
// - Repassa para o servidor Baileys com header x-api-key (WHATSAPP_API_KEY).
// - Loga sucesso/erro de cada tentativa.
// - Persiste em whatsapp_messages com direction="out".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------- rate limit em memória (best-effort por instância) ----------
// 20 envios por usuário a cada 60s.
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, number[]>();

function rateLimit(userId: string): boolean {
  const now = Date.now();
  const arr = (rateBuckets.get(userId) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  if (arr.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(userId, arr);
    return false;
  }
  arr.push(now);
  rateBuckets.set(userId, arr);
  return true;
}

// ---------- validações ----------
const NUMBER_RE = /^[0-9+\-\s()]{6,32}$/;
const MAX_MESSAGE_LEN = 4000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method not allowed" }, 405);
  }

  // -------- Auth (JWT do Supabase) --------
  const authHeader = req.headers.get("Authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";
  if (!accessToken) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRes, error: userErr } =
    await supabase.auth.getUser(accessToken);
  if (userErr || !userRes.user) {
    console.warn("[send-whatsapp-message] invalid session");
    return json({ ok: false, error: "invalid session" }, 401);
  }
  const userId = userRes.user.id;

  // Rate limit
  if (!rateLimit(userId)) {
    console.warn("[send-whatsapp-message] rate limited", { userId });
    return json({ ok: false, error: "rate limit exceeded" }, 429);
  }

  // Resolve empresa do usuário
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  const companyId = profile?.company_id;
  if (!companyId) {
    return json({ ok: false, error: "profile without company" }, 403);
  }

  // -------- Body + validação --------
  let payload: { number?: unknown; message?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  const number =
    typeof payload.number === "string" ? payload.number.trim() : "";
  const message =
    typeof payload.message === "string" ? payload.message.trim() : "";

  if (!number || !NUMBER_RE.test(number)) {
    return json({ ok: false, error: "invalid number" }, 400);
  }
  if (!message || message.length > MAX_MESSAGE_LEN) {
    return json({ ok: false, error: "invalid message" }, 400);
  }

  // -------- Config do servidor Baileys --------
  const serverUrl = Deno.env.get("WHATSAPP_SERVER_URL");
  const apiKey = Deno.env.get("WHATSAPP_API_KEY");
  if (!serverUrl) {
    return json(
      { ok: false, error: "WHATSAPP_SERVER_URL not configured" },
      500,
    );
  }
  if (!apiKey) {
    return json(
      { ok: false, error: "WHATSAPP_API_KEY not configured" },
      500,
    );
  }

  // -------- Envia ao servidor Baileys --------
  let sendOk = false;
  let sendError: string | null = null;
  try {
    const target = `${serverUrl.replace(/\/+$/, "")}/send`;
    const res = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "lovable-edge-function",
      },
      body: JSON.stringify({ numero: number, mensagem: message }),
    });
    const txt = await res.text();
    if (!res.ok) {
      sendError = `Baileys ${res.status}`;
      console.error("[send-whatsapp-message] baileys error", {
        userId,
        companyId,
        status: res.status,
        body: txt.slice(0, 300),
      });
    } else {
      sendOk = true;
      console.log("[send-whatsapp-message] sent", {
        userId,
        companyId,
        number,
      });
    }
  } catch (e) {
    sendError = "network error";
    console.error("[send-whatsapp-message] network failure", {
      userId,
      companyId,
      err: e instanceof Error ? e.message : String(e),
    });
  }

  if (!sendOk) {
    return json({ ok: false, error: sendError ?? "send failed" }, 502);
  }

  // -------- Persiste mensagem enviada --------
  const { error: insertErr } = await supabase.from("whatsapp_messages").insert({
    company_id: companyId,
    numero: number,
    mensagem: message,
    direction: "out",
    origem: "app",
  });

  if (insertErr) {
    console.error("[send-whatsapp-message] insert failed", {
      userId,
      companyId,
      err: insertErr.message,
    });
    // Mensagem foi enviada com sucesso, apenas o registro falhou.
    return json({ ok: true, warning: "message sent but not logged" });
  }

  return json({ ok: true });
});
