// Edge Function: whatsapp-qr-incoming
// Recebe mensagens do servidor WhatsApp QR Code externo (POST JSON)
// e insere na tabela public.whatsapp_messages do banco interno do Lovable.
//
// Endpoint público (sem JWT) — configurado em supabase/config.toml.
//
// Payload esperado:
// {
//   numero: string,
//   mensagem: string,
//   direction: "in" | "out",
//   origem?: string,
//   created_at?: string (ISO)
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, x-qr-token, x-company-id, authorization, apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (req) => {
  // CORS preflight
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

  // Parse body
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const numero =
    typeof payload?.numero === "string" ? payload.numero.trim() : "";
  const mensagem =
    typeof payload?.mensagem === "string" ? payload.mensagem.trim() : "";
  const direction = payload?.direction === "out" ? "out" : "in";
  const origem =
    typeof payload?.origem === "string"
      ? payload.origem.trim().slice(0, 64)
      : "whatsapp_qr";
  const created_at =
    typeof payload?.created_at === "string" ? payload.created_at : undefined;

  // Validações
  // Aceita: telefone normal OU JID do WhatsApp (ex.: 12345@lid, 5511...@s.whatsapp.net, ...@g.us)
  const isPhone = /^[0-9+\-\s()]+$/.test(numero);
  const isJid = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/.test(numero);
  if (!numero || numero.length > 128 || (!isPhone && !isJid)) {
    return json({ ok: false, error: "Invalid 'numero'" }, 400);
  }
  if (!mensagem || mensagem.length > 4000) {
    return json({ ok: false, error: "Invalid 'mensagem'" }, 400);
  }

  // Se for JID sem telefone real, normaliza para preservar o identificador único
  // O campo `numero` aceita texto, então salvamos o JID inteiro como identificador.
  // Mensagens antigas com telefone continuam funcionando normalmente.

  // Cliente admin (service role) para bypass de RLS
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolve company_id (header opcional ou primeira empresa cadastrada)
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

  // Insert na tabela whatsapp_messages
  const { error: insertErr } = await supabase
    .from("whatsapp_messages")
    .insert({
      company_id: companyId,
      numero,
      mensagem,
      direction,
      origem,
      ...(created_at ? { created_at } : {}),
    });

  if (insertErr) {
    console.error("[whatsapp-qr-incoming] insert error", insertErr);
    return json({ ok: false, error: "internal error" }, 500);
  }

  return json({ ok: true });
});
