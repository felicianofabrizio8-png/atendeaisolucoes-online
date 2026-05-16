// Edge Function: whatsapp-status
// Consulta status / QR / contacts da Evolution API.
// Exige JWT do usuário autenticado (verify_jwt=true).

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "unauthorized" }, 401);

  const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL");
  const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY");
  const EVOLUTION_INSTANCE = Deno.env.get("EVOLUTION_INSTANCE_NAME");
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE) {
    return json({ ok: false, error: "Evolution API não configurada" }, 500);
  }
  const baseUrl = EVOLUTION_API_URL.replace(/\/+$/, "");
  const inst = encodeURIComponent(EVOLUTION_INSTANCE);

  let payload: { action?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    /* defaults */
  }
  const action = typeof payload.action === "string" ? payload.action : "status";

  const headers = { apikey: EVOLUTION_API_KEY, "Content-Type": "application/json" };

  try {
    if (action === "status") {
      const res = await fetch(`${baseUrl}/instance/connectionState/${inst}`, { headers });
      const txt = await res.text();
      if (!res.ok) {
        return json({
          ok: false,
          connected: false,
          error: `Evolution ${res.status}: ${txt.slice(0, 200)}`,
        });
      }
      const parsed = JSON.parse(txt) as {
        instance?: { state?: string };
        state?: string;
      };
      const state = parsed?.instance?.state ?? parsed?.state ?? "unknown";
      return json({
        ok: true,
        connected: state === "open",
        state,
        instance: EVOLUTION_INSTANCE,
      });
    }

    if (action === "qr") {
      const res = await fetch(`${baseUrl}/instance/connect/${inst}`, { headers });
      const txt = await res.text();
      if (!res.ok) {
        return json({
          ok: false,
          connected: false,
          error: `Evolution ${res.status}: ${txt.slice(0, 200)}`,
        });
      }
      const parsed = JSON.parse(txt) as {
        base64?: string;
        code?: string;
        pairingCode?: string;
        instance?: { state?: string };
      };
      const state = parsed?.instance?.state;
      if (state === "open") {
        return json({ ok: true, connected: true });
      }
      return json({
        ok: true,
        connected: false,
        qrcode: parsed?.base64 ?? parsed?.code,
        pairingCode: parsed?.pairingCode,
      });
    }

    if (action === "contacts") {
      const res = await fetch(`${baseUrl}/chat/findContacts/${inst}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ where: {} }),
      });
      const txt = await res.text();
      if (!res.ok) {
        return json({
          ok: false,
          contacts: [],
          error: `Evolution ${res.status}: ${txt.slice(0, 200)}`,
        });
      }
      const parsed = JSON.parse(txt) as unknown;
      const rawList = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { contacts?: unknown[] })?.contacts)
          ? (parsed as { contacts: unknown[] }).contacts
          : [];
      const contacts = rawList.slice(0, 5000).map((item) => {
        const row = item as Record<string, unknown>;
        const jid =
          (typeof row.remoteJid === "string" && row.remoteJid) ||
          (typeof row.id === "string" && row.id) ||
          "";
        const numero =
          jid && jid.endsWith("@s.whatsapp.net")
            ? jid.split("@")[0]
            : typeof row.number === "string"
              ? row.number
              : "";
        const push_name =
          (typeof row.pushName === "string" && row.pushName) ||
          (typeof row.name === "string" && row.name) ||
          "";
        return { id: jid || numero, numero, whatsapp_jid: jid, push_name };
      });
      return json({ ok: true, contacts });
    }

    return json({ ok: false, error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "network error" },
      502,
    );
  }
});
