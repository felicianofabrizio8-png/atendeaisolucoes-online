// Endpoint público para receber mensagens do servidor WhatsApp QR Code externo.
//
// URL estável:
//   https://project--<projectId>.lovable.app/api/public/whatsapp-qr/incoming
//
// Autenticação: header `x-qr-token` deve bater com a env WHATSAPP_QR_TOKEN.
//
// Body (JSON):
//   {
//     numero: string,
//     mensagem: string,
//     direction: "in" | "out",
//     origem?: "whatsapp_qr",
//     created_at?: string (ISO)
//   }
//
// Seleção de company_id:
//   - Header opcional `x-company-id` tem prioridade
//   - Caso ausente, usa a empresa mais antiga (single-tenant default)

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

const IncomingSchema = z.object({
  numero: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .refine(
      (v) => /^[0-9+\-\s()]+$/.test(v) || /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/.test(v),
      { message: "must be a phone number or WhatsApp JID" },
    ),
  whatsapp_jid: z.string().trim().max(128).optional(),
  push_name: z.string().trim().max(120).optional(),
  mensagem: z.string().trim().min(1).max(4000),
  direction: z.enum(["in", "out"]).default("in"),
  origem: z.string().max(64).optional(),
  created_at: z.string().datetime().optional(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-qr-token, x-company-id",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export const Route = createFileRoute("/api/public/whatsapp-qr/incoming")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      POST: async ({ request }) => {
        // Auth opcional via token compartilhado
        const expectedToken = process.env.WHATSAPP_QR_TOKEN;
        if (expectedToken) {
          const provided = request.headers.get("x-qr-token") ?? "";
          if (provided !== expectedToken) {
            return json({ ok: false, error: "Unauthorized" }, 401);
          }
        }

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json({ ok: false, error: "Invalid JSON" }, 400);
        }

        const parsed = IncomingSchema.safeParse(raw);
        if (!parsed.success) {
          return json(
            { ok: false, error: "Invalid payload", issues: parsed.error.issues },
            400,
          );
        }
        const data = parsed.data;

        // Resolver company_id
        let companyId = request.headers.get("x-company-id") ?? "";
        if (!companyId) {
          const { data: company, error: companyErr } = await supabaseAdmin
            .from("companies")
            .select("id")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (companyErr || !company) {
            return json({ ok: false, error: "No company found" }, 500);
          }
          companyId = company.id;
        }

        const { error: insertErr } = await supabaseAdmin
          .from("whatsapp_messages")
          .insert({
            company_id: companyId,
            numero: data.numero,
            mensagem: data.mensagem,
            direction: data.direction,
            ...(data.created_at ? { created_at: data.created_at } : {}),
          });

        if (insertErr) {
          console.error("[whatsapp-qr/incoming] insert error", insertErr);
          return json({ ok: false, error: insertErr.message }, 500);
        }

        return json({ ok: true });
      },
    },
  },
});
