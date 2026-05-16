// Webhook público que recebe eventos da Evolution API.
// Configurar na Evolution para apontar para:
//   {SUPABASE_URL}/functions/v1/whatsapp-evolution-incoming
// Proteção: header x-evolution-token == EVOLUTION_WEBHOOK_TOKEN (se setado).
// verify_jwt = false (chamada vem da Evolution, não do app).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Resolve company_id: por enquanto pega a primeira empresa existente
// (instância única). Se você operar multi-tenant na Evolution, troque
// para mapear pelo instanceName que vier no payload.
async function resolveCompanyId(
  supabase: ReturnType<typeof createClient>,
): Promise<string | null> {
  const { data } = await supabase
    .from("companies")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const expectedToken = Deno.env.get("EVOLUTION_WEBHOOK_TOKEN");
  if (expectedToken) {
    const got = req.headers.get("x-evolution-token") ?? req.headers.get("apikey") ?? "";
    if (got !== expectedToken) return json({ ok: false, error: "invalid token" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const companyId = await resolveCompanyId(supabase);
  if (!companyId) return json({ ok: false, error: "no company" }, 500);

  const event = typeof body.event === "string" ? body.event : "";
  console.log("[whatsapp-evolution-incoming] event", event);

  // Eventos relevantes: messages.upsert (e variantes)
  if (event !== "messages.upsert" && event !== "MESSAGES_UPSERT") {
    return json({ ok: true, ignored: event });
  }

  const data = (body.data ?? {}) as Record<string, unknown>;
  // Evolution às vezes envia um único objeto, às vezes array de messages.
  const items: Record<string, unknown>[] = Array.isArray(data.messages)
    ? (data.messages as Record<string, unknown>[])
    : [data];

  let inserted = 0;
  for (const item of items) {
    const key = (item.key ?? {}) as Record<string, unknown>;
    const remoteJid = typeof key.remoteJid === "string" ? key.remoteJid : "";
    const fromMe = Boolean(key.fromMe);
    const msg = (item.message ?? {}) as Record<string, unknown>;
    const text =
      (typeof msg.conversation === "string" && msg.conversation) ||
      (typeof (msg.extendedTextMessage as { text?: string } | undefined)?.text === "string" &&
        (msg.extendedTextMessage as { text: string }).text) ||
      (typeof (msg.imageMessage as { caption?: string } | undefined)?.caption === "string" &&
        (msg.imageMessage as { caption: string }).caption) ||
      "";

    if (!remoteJid || !text) continue;

    const numero =
      remoteJid.endsWith("@s.whatsapp.net") || remoteJid.endsWith("@g.us")
        ? remoteJid.split("@")[0]
        : remoteJid;

    const pushName = typeof item.pushName === "string" ? item.pushName : null;
    const ts =
      typeof item.messageTimestamp === "number"
        ? new Date(item.messageTimestamp * 1000).toISOString()
        : new Date().toISOString();

    const { error } = await supabase.from("whatsapp_messages").insert({
      company_id: companyId,
      numero,
      mensagem: text,
      direction: fromMe ? "out" : "in",
      origem: "evolution",
      whatsapp_jid: remoteJid,
      push_name: pushName,
      created_at: ts,
    });
    if (error) {
      console.error("[whatsapp-evolution-incoming] insert failed", error.message);
    } else {
      inserted++;
    }
  }

  return json({ ok: true, inserted });
});
