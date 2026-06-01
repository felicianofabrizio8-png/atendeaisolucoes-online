// Lista eventos WhatsApp recebidos pela Meta que não casaram com nenhuma
// integração cadastrada da empresa. Usado pelo painel administrativo em
// Configurações para alertar o usuário sobre números "irmãos" no Business
// Manager que ainda não estão conectados (ou que precisam ser desativados).

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/whatsapp/unmapped")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        if (!auth.startsWith("Bearer ")) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        const url = process.env.SUPABASE_URL!;
        const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const sb = createClient(url, key, {
          global: { headers: { Authorization: auth } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await sb
          .from("whatsapp_unmapped_events")
          .select(
            "id, phone_number_id, waba_id, display_phone_number, from_wa_id, contact_name, message_preview, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) {
          return Response.json({ error: error.message }, { status: 500 });
        }
        return Response.json({ events: data ?? [] });
      },
    },
  },
});
