// Edge Function: whatsapp-status
// Consulta status / QR / contacts / sync da Evolution API.
// Exige JWT do usuário autenticado (verify_jwt=true).

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

type EvoContact = {
  id: string;
  numero: string;
  whatsapp_jid: string;
  push_name: string;
};

function pickStr(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function jidToPhone(jid: string): string {
  if (!jid) return "";
  const [local, domain] = jid.split("@");
  if ((domain ?? "").toLowerCase() === "s.whatsapp.net" && /^\d{8,15}$/.test(local ?? "")) {
    return local;
  }
  return "";
}

function digitsOnly(v: string): string {
  const d = v.replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? d : "";
}

function normalizeRow(row: Record<string, unknown>): EvoContact {
  const jid = pickStr(row, "remoteJid", "id", "jid");
  const fromJid = jidToPhone(jid);
  const numero =
    fromJid ||
    digitsOnly(pickStr(row, "number", "phone", "phoneNumber")) ||
    "";
  const push_name = pickStr(row, "pushName", "name", "verifiedName", "notify");
  return {
    id: jid || numero,
    numero,
    whatsapp_jid: jid,
    push_name,
  };
}

async function evoFetch(baseUrl: string, path: string, apikey: string, init?: RequestInit) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { apikey, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const txt = await res.text();
  return { ok: res.ok, status: res.status, txt };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!accessToken) return json({ ok: false, error: "unauthorized" }, 401);

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

  try {
    if (action === "status") {
      const { ok, status, txt } = await evoFetch(
        baseUrl,
        `/instance/connectionState/${inst}`,
        EVOLUTION_API_KEY,
      );
      if (!ok) {
        return json({
          ok: false,
          connected: false,
          error: `Evolution ${status}: ${txt.slice(0, 200)}`,
        });
      }
      const parsed = JSON.parse(txt) as { instance?: { state?: string }; state?: string };
      const state = parsed?.instance?.state ?? parsed?.state ?? "unknown";
      return json({ ok: true, connected: state === "open", state, instance: EVOLUTION_INSTANCE });
    }

    if (action === "qr") {
      const { ok, status, txt } = await evoFetch(
        baseUrl,
        `/instance/connect/${inst}`,
        EVOLUTION_API_KEY,
      );
      if (!ok) {
        return json({
          ok: false,
          connected: false,
          error: `Evolution ${status}: ${txt.slice(0, 200)}`,
        });
      }
      const parsed = JSON.parse(txt) as {
        base64?: string;
        code?: string;
        pairingCode?: string;
        instance?: { state?: string };
      };
      const state = parsed?.instance?.state;
      if (state === "open") return json({ ok: true, connected: true });
      return json({
        ok: true,
        connected: false,
        qrcode: parsed?.base64 ?? parsed?.code,
        pairingCode: parsed?.pairingCode,
      });
    }

    if (action === "contacts" || action === "sync") {
      console.log("SYNC_CONTACTS_START", { instance: EVOLUTION_INSTANCE, baseUrl });

      // Helper: tenta múltiplos paths (POST e GET) e retorna o primeiro array não-vazio.
      async function tryEndpoints(
        endpoints: Array<{ path: string; method: "GET" | "POST"; body?: unknown }>,
        label: string,
      ): Promise<Record<string, unknown>[]> {
        for (const ep of endpoints) {
          const init: RequestInit = { method: ep.method };
          if (ep.method === "POST") init.body = JSON.stringify(ep.body ?? {});
          const r = await evoFetch(baseUrl, ep.path, EVOLUTION_API_KEY!, init);
          console.log(`SYNC_${label}_TRY`, {
            path: ep.path,
            method: ep.method,
            status: r.status,
            ok: r.ok,
            sample: r.txt.slice(0, 300),
          });
          if (!r.ok) continue;
          try {
            const parsed = JSON.parse(r.txt) as unknown;
            const rows: Record<string, unknown>[] = Array.isArray(parsed)
              ? (parsed as Record<string, unknown>[])
              : Array.isArray((parsed as { contacts?: unknown[] })?.contacts)
                ? (parsed as { contacts: Record<string, unknown>[] }).contacts
                : Array.isArray((parsed as { chats?: unknown[] })?.chats)
                  ? (parsed as { chats: Record<string, unknown>[] }).chats
                  : Array.isArray((parsed as { data?: unknown[] })?.data)
                    ? (parsed as { data: Record<string, unknown>[] }).data
                    : Array.isArray((parsed as { response?: unknown[] })?.response)
                      ? (parsed as { response: Record<string, unknown>[] }).response
                      : [];
            if (rows.length > 0) {
              console.log(`SYNC_${label}_OK`, { path: ep.path, count: rows.length });
              return rows;
            }
          } catch (e) {
            console.warn(`SYNC_${label}_PARSE_FAIL`, ep.path, (e as Error).message);
          }
        }
        return [];
      }

      const contactRows = await tryEndpoints(
        [
          { path: `/chat/findContacts/${inst}`, method: "POST", body: { where: {} } },
          { path: `/chat/findContacts/${inst}`, method: "POST", body: {} },
          { path: `/chat/findContacts/${inst}`, method: "GET" },
          { path: `/instance/fetchContacts/${inst}`, method: "GET" },
        ],
        "CONTACTS",
      );

      const chatRows = await tryEndpoints(
        [
          { path: `/chat/findChats/${inst}`, method: "POST", body: {} },
          { path: `/chat/findChats/${inst}`, method: "POST", body: { where: {} } },
          { path: `/chat/findChats/${inst}`, method: "GET" },
        ],
        "CHATS",
      );

      // 3) Normalizar e mesclar (por jid)
      const byJid = new Map<string, EvoContact>();
      const byPhone = new Map<string, EvoContact>();
      const addRow = (raw: Record<string, unknown>) => {
        const c = normalizeRow(raw);
        if (!c.whatsapp_jid && !c.numero) return;
        const key = c.whatsapp_jid || c.numero;
        const prev = byJid.get(key);
        const merged: EvoContact = {
          id: c.id || prev?.id || key,
          whatsapp_jid: c.whatsapp_jid || prev?.whatsapp_jid || "",
          numero: c.numero || prev?.numero || "",
          push_name: c.push_name || prev?.push_name || "",
        };
        byJid.set(key, merged);
        if (merged.numero) byPhone.set(merged.numero, merged);
        console.log("SYNC_CONTACT_FOUND", {
          jid: merged.whatsapp_jid,
          numero: merged.numero,
          name: merged.push_name,
        });
      };
      for (const r of contactRows.slice(0, 5000)) addRow(r);
      for (const r of chatRows.slice(0, 5000)) addRow(r);

      const contacts = [...byJid.values()];

      // 4) (action=sync) tentar resolver telefone real em whatsapp_messages
      let updated = 0;
      if (action === "sync") {
        const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
        const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: userRes } = await supabase.auth.getUser(accessToken);
        const userId = userRes?.user?.id;
        if (userId) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("company_id")
            .eq("id", userId)
            .maybeSingle();
          const companyId = profile?.company_id as string | undefined;

          if (companyId) {
            for (const c of contacts) {
              if (!c.numero || !c.whatsapp_jid) continue;
              // Atualiza mensagens que apontam pro mesmo JID mas estão sem telefone real
              const { error: upErr, count } = await supabase
                .from("whatsapp_messages")
                .update({ numero: c.numero, push_name: c.push_name || null })
                .eq("company_id", companyId)
                .eq("whatsapp_jid", c.whatsapp_jid)
                .neq("numero", c.numero)
                .select("*", { count: "exact", head: true });
              if (upErr) {
                console.warn("SYNC_CONTACT_UPDATE_FAIL", upErr.message);
              } else if (count && count > 0) {
                updated += count;
                console.log("SYNC_CONTACT_UPDATED", { jid: c.whatsapp_jid, numero: c.numero, count });
              }
              console.log("SYNC_PHONE_RESOLVED", { jid: c.whatsapp_jid, numero: c.numero });
            }
          }
        }
      }

      return json({ ok: true, contacts, updated });
    }

    return json({ ok: false, error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "network error" }, 502);
  }
});
