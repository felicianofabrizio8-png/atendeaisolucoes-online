// ============================================================================
// GET /api/executive/conversation-intelligence/inspect
// Admin-only. Lista fatos estruturados sanitizados para inspeção humana.
// NUNCA retorna PII, IDs externos, tokens ou texto de mensagens.
// ============================================================================
import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { listFactsForInspection } from "@/lib/conversation-intelligence/ConversationFactsRepository.server";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(["in_progress", "sold", "lost", "abandoned", "completed"]).optional(),
  channel: z.string().max(32).optional(),
  confidenceMin: z.coerce.number().min(0).max(1).optional(),
  period: z.enum(["7d", "30d", "90d"]).optional(),
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer ")) return null;
  const t = h.slice(7).trim();
  return t.length > 0 ? t : null;
}

function makeUserClient(token: string): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("missing_env");
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

const methodNotAllowed = () => json(405, { ok: false, error: "method_not_allowed" });

async function authorize(request: Request) {
  const token = bearer(request);
  if (!token) return { error: json(401, { ok: false, error: "unauthorized" }) };
  const supabase = makeUserClient(token);
  const { data: u } = await supabase.auth.getUser(token);
  if (!u?.user) return { error: json(401, { ok: false, error: "unauthorized" }) };
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", u.user.id)
    .maybeSingle();
  if (!profile?.company_id)
    return { error: json(403, { ok: false, error: "forbidden_no_company" }) };
  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: u.user.id,
    _company_id: profile.company_id,
    _role: "admin",
  });
  if (isAdmin !== true) return { error: json(403, { ok: false, error: "forbidden_role" }) };
  return { companyId: profile.company_id };
}

export const Route = createFileRoute("/api/executive/conversation-intelligence/inspect")({
  server: {
    handlers: {
      POST: methodNotAllowed,
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
      GET: async ({ request }: { request: Request }) => {
        try {
          const auth = await authorize(request);
          if (auth.error) return auth.error;

          const url = new URL(request.url);
          const parsed = QuerySchema.safeParse({
            limit: url.searchParams.get("limit") ?? undefined,
            status: url.searchParams.get("status") ?? undefined,
            channel: url.searchParams.get("channel") ?? undefined,
            confidenceMin: url.searchParams.get("confidenceMin") ?? undefined,
            period: url.searchParams.get("period") ?? undefined,
          });
          if (!parsed.success) {
            return json(400, { ok: false, error: "invalid_params" });
          }

          const sinceDays =
            parsed.data.period === "7d" ? 7 : parsed.data.period === "90d" ? 90 : parsed.data.period === "30d" ? 30 : undefined;

          const rows = await listFactsForInspection({
            companyId: auth.companyId,
            limit: parsed.data.limit,
            lifecycle: parsed.data.status,
            channel: parsed.data.channel,
            confidenceMin: parsed.data.confidenceMin,
            sinceDays,
          });

          // Devolve pseudo-id posicional para o frontend em vez do UUID interno.
          const sanitized = rows.map((r, idx) => ({
            sample_id: `#${idx + 1}`,
            analyzer_version: r.analyzer_version,
            lifecycle_status: r.lifecycle_status,
            primary_intent: r.primary_intent,
            intents: r.intents_json,
            objections: r.objections_json,
            buying_signals: r.buying_signals_json,
            negative_signals: r.negative_signals_json,
            products: r.products_json,
            topics: r.topics_json,
            sentiment_label: r.sentiment_label,
            sentiment_score: r.sentiment_score,
            channel: r.channel,
            lead_source: r.lead_source,
            message_count: r.message_count,
            lead_message_count: r.lead_message_count,
            agent_message_count: r.agent_message_count,
            first_response_minutes: r.first_response_minutes,
            negotiation_duration_minutes: r.negotiation_duration_minutes,
            quote_detected: r.quote_detected,
            sale_detected: r.sale_detected,
            loss_detected: r.loss_detected,
            confidence: r.confidence,
            extraction_method: r.extraction_method,
            quality_warnings: r.quality_warnings_json,
            analyzed_at: r.analyzed_at,
          }));

          return json(200, { ok: true, count: sanitized.length, data: sanitized });
        } catch {
          return json(500, { ok: false, error: "internal_error" });
        }
      },
    },
  },
});
