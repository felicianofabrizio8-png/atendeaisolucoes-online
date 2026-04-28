// Edge Function: send-whatsapp-message
// Recebe { number, message } do app, repassa para o servidor Baileys
// (WHATSAPP_SERVER_URL/send) e, em caso de sucesso, registra a mensagem
// como direction="out" na tabela whatsapp_messages.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-company-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method not allowed" }, 405);
  }

  let payload: { number?: string; message?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  const number = (payload.number ?? "").toString().trim();
  const message = (payload.message ?? "").toString();
  if (!number || !message.trim()) {
    return json({ ok: false, error: "number and message are required" }, 400);
  }

  const serverUrl = Deno.env.get("WHATSAPP_SERVER_URL");
  if (!serverUrl) {
    return json(
      { ok: false, error: "WHATSAPP_SERVER_URL not configured" },
      500,
    );
  }

  // 1) Envia ao servidor Baileys
  let sendOk = false;
  let sendError: string | null = null;
  try {
    const target = `${serverUrl.replace(/\/+$/, "")}/send`;
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero: number, mensagem: message }),
    });
    const txt = await res.text();
    if (!res.ok) {
      sendError = `Baileys ${res.status}: ${txt.slice(0, 300)}`;
    } else {
      sendOk = true;
    }
  } catch (e) {
    sendError = e instanceof Error ? e.message : "network error";
  }

  if (!sendOk) {
    console.error("send-whatsapp-message failed:", sendError);
    return json({ ok: false, error: sendError ?? "send failed" }, 502);
  }

  // 2) Registra a mensagem enviada (direction=out) no banco
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // company_id: header x-company-id ou primeira empresa disponível
  let companyId = req.headers.get("x-company-id");
  if (!companyId) {
    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .limit(1)
      .maybeSingle();
    companyId = company?.id ?? null;
  }
  if (!companyId) {
    return json({ ok: false, error: "no company found" }, 500);
  }

  const { error: insertErr } = await supabase
    .from("whatsapp_messages")
    .insert({
      company_id: companyId,
      numero: number,
      mensagem: message,
      direction: "out",
      origem: "app",
    });

  if (insertErr) {
    console.error("insert out message failed:", insertErr.message);
    // Mensagem foi enviada no WhatsApp, mas falhou ao gravar.
    return json({ ok: true, warning: insertErr.message });
  }

  return json({ ok: true });
});
