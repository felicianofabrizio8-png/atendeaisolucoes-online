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
      // 1) Buscar contatos
      console.log("SYNC_CONTACTS_START", { instance: EVOLUTION_INSTANCE });
      const cRes = await evoFetch(baseUrl, `/chat/findContacts/${inst}`, EVOLUTION_API_KEY, {
        method: "POST",
        body: JSON.stringify({ where: {} }),
      });
      let contactRows: Record<string, unknown>[] = [];
      if (cRes.ok) {
        const parsed = JSON.parse(cRes.txt) as unknown;
        contactRows = Array.isArray(parsed)
          ? (parsed as Record<string, unknown>[])
          : Array.isArray((parsed as { contacts?: unknown[] })?.contacts)
            ? ((parsed as { contacts: Record<string, unknown>[] }).contacts)
            : [];
      } else {
        console.warn("SYNC_CONTACTS contacts fetch failed", cRes.status, cRes.txt.slice(0, 200));
      }

      // 2) Buscar chats (traz pushName por remoteJid em muitos casos)
      const chRes = await evoFetch(baseUrl, `/chat/findChats/${inst}`, EVOLUTION_API_KEY, {
        method: "POST",
        body: JSON.stringify({}),
      });
      let chatRows: Record<string, unknown>[] = [];
      if (chRes.ok) {
        try {
          const parsed = JSON.parse(chRes.txt) as unknown;
          chatRows = Array.isArray(parsed)
            ? (parsed as Record<string, unknown>[])
            : Array.isArray((parsed as { chats?: unknown[] })?.chats)
              ? ((parsed as { chats: Record<string, unknown>[] }).chats)
              : [];
        } catch {
          chatRows = [];
        }
      } else {
        console.warn("SYNC_CONTACTS chats fetch failed", chRes.status, chRes.txt.slice(0, 200));
      }

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
