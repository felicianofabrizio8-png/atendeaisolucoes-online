// Edge Function: whatsapp-qr-incoming
// Recebe mensagens do servidor WhatsApp QR Code externo e insere em whatsapp_messages.
//
// Endpoint público (sem JWT) — configurado em supabase/config.toml.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-qr-token, x-company-id, authorization, apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  // Auth opcional via token compartilhado
  const expectedToken = Deno.env.get("WHATSAPP_QR_TOKEN");
  if (expectedToken) {
    const provided = req.headers.get("x-qr-token") ?? "";
    if (provided !== expectedToken) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const numero = typeof payload?.numero === "string" ? payload.numero.trim() : "";
  const mensagem = typeof payload?.mensagem === "string" ? payload.mensagem.trim() : "";
  const direction = payload?.direction === "out" ? "out" : "in";
  const origem = typeof payload?.origem === "string" ? payload.origem.trim().slice(0, 64) : undefined;
  const created_at = typeof payload?.created_at === "string" ? payload.created_at : undefined;

  if (!numero || numero.length > 32 || !/^[0-9+\-\s()]+$/.test(numero)) {
    return json({ ok: false, error: "Invalid 'numero'" }, 400);
  }
  if (!mensagem || mensagem.length > 4000) {
    return json({ ok: false, error: "Invalid 'mensagem'" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolver company_id (header ou empresa default)
  let companyId = req.headers.get("x-company-id") ?? "";
  if (!companyId) {
    const { data: company, error: companyErr } = await supabase
      .from("companies")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (companyErr || !company) {
      console.error("[whatsapp-qr-incoming] no company", companyErr);
      return json({ ok: false, error: "No company found" }, 500);
    }
    companyId = company.id;
  }

  const { error: insertErr } = await supabase
    .from("whatsapp_messages")
    .insert({
      company_id: companyId,
      numero,
      mensagem,
      direction,
      ...(created_at ? { created_at } : {}),
    });

  if (insertErr) {
    console.error("[whatsapp-qr-incoming] insert error", insertErr);
    return json({ ok: false, error: insertErr.message }, 500);
  }

  return json({ ok: true });
});
