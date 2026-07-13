// Repositório de conversation_facts. Escrita EXCLUSIVAMENTE via service_role
// em jobs server-only. Escopo restrito e sempre validando company_id.
import type { ConversationFactsRow } from "./ConversationIntelligenceTypes";

// Alias sem tipos gerados (types.ts é regenerado após aprovação da migration).
type LooseClient = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, v: unknown) => {
        eq: (col: string, v: unknown) => {
          eq: (col: string, v: unknown) => {
            eq: (col: string, v: unknown) => {
              maybeSingle: () => Promise<{ data: { id: string } | null }>;
            };
          };
        };
      };
    };
    insert: (row: Record<string, unknown>) => Promise<{ error: { code?: string; message?: string } | null }>;
  };
};

/** Insere se (company, conv, version, hash) não existir; retorna false se já existia. */
export async function upsertFactIfNew(
  row: ConversationFactsRow
): Promise<{ inserted: boolean; error?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const client = supabaseAdmin as unknown as LooseClient;

  const { data: existing } = await client
    .from("conversation_facts")
    .select("id")
    .eq("company_id", row.company_id)
    .eq("conversation_id", row.conversation_id)
    .eq("analyzer_version", row.analyzer_version)
    .eq("content_hash", row.content_hash)
    .maybeSingle();

  if (existing) return { inserted: false };

  const { error } = await client.from("conversation_facts").insert({
    company_id: row.company_id,
    conversation_id: row.conversation_id,
    analyzer_version: row.analyzer_version,
    content_hash: row.content_hash,
    lifecycle_status: row.lifecycle_status,
    primary_intent: row.primary_intent,
    intents_json: row.intents_json,
    objections_json: row.objections_json,
    buying_signals_json: row.buying_signals_json,
    negative_signals_json: row.negative_signals_json,
    products_json: row.products_json,
    topics_json: row.topics_json,
    quality_warnings_json: row.quality_warnings_json,
    sentiment_label: row.sentiment_label,
    sentiment_score: row.sentiment_score,
    lead_source: row.lead_source,
    channel: row.channel,
    message_count: row.message_count,
    lead_message_count: row.lead_message_count,
    agent_message_count: row.agent_message_count,
    first_message_at: row.first_message_at,
    last_message_at: row.last_message_at,
    first_response_minutes: row.first_response_minutes,
    negotiation_duration_minutes: row.negotiation_duration_minutes,
    quote_detected: row.quote_detected,
    sale_detected: row.sale_detected,
    loss_detected: row.loss_detected,
    confidence: row.confidence,
    extraction_method: row.extraction_method,
    analyzed_at: row.analyzed_at,
  });

  if (error) return { inserted: false, error: error.code ?? "insert_failed" };
  return { inserted: true };
}

export interface InspectFilter {
  companyId: string;
  limit: number;
  lifecycle?: string;
  channel?: string;
  confidenceMin?: number;
  sinceDays?: number;
}

export async function listFactsForInspection(f: InspectFilter) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Cast necessário: types.ts é regenerado apenas após aprovação da migration.
  const client = supabaseAdmin as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, v: unknown) => unknown;
      };
    };
  };
  let q = client
    .from("conversation_facts")
    .select(
      "id, analyzer_version, lifecycle_status, primary_intent, intents_json, " +
        "objections_json, buying_signals_json, negative_signals_json, products_json, topics_json, " +
        "sentiment_label, sentiment_score, channel, lead_source, " +
        "message_count, lead_message_count, agent_message_count, " +
        "first_response_minutes, negotiation_duration_minutes, " +
        "quote_detected, sale_detected, loss_detected, confidence, " +
        "extraction_method, quality_warnings_json, analyzed_at"
    )
    .eq("company_id", f.companyId) as unknown as {
      order: (col: string, opts: { ascending: boolean }) => unknown;
    };
  let qb = q.order("analyzed_at", { ascending: false }) as unknown as {
    limit: (n: number) => unknown;
    eq: (col: string, v: unknown) => unknown;
    gte: (col: string, v: unknown) => unknown;
  };
  qb = qb.limit(Math.min(f.limit, 50)) as typeof qb;
  if (f.lifecycle) qb = qb.eq("lifecycle_status", f.lifecycle) as typeof qb;
  if (f.channel) qb = qb.eq("channel", f.channel) as typeof qb;
  if (f.confidenceMin !== undefined) qb = qb.gte("confidence", f.confidenceMin) as typeof qb;
  if (f.sinceDays) {
    qb = qb.gte("analyzed_at", new Date(Date.now() - f.sinceDays * 86400_000).toISOString()) as typeof qb;
  }
  const { data, error } = (await (qb as unknown as Promise<{ data: FactInspectRow[] | null; error: { message: string } | null }>));
  if (error) throw new Error(error.message);
  return data ?? [];
}

export interface FactInspectRow {
  id: string;
  analyzer_version: string;
  lifecycle_status: string | null;
  primary_intent: string | null;
  intents_json: string[];
  objections_json: string[];
  buying_signals_json: string[];
  negative_signals_json: string[];
  products_json: string[];
  topics_json: string[];
  sentiment_label: string | null;
  sentiment_score: number | null;
  channel: string | null;
  lead_source: string | null;
  message_count: number;
  lead_message_count: number;
  agent_message_count: number;
  first_response_minutes: number | null;
  negotiation_duration_minutes: number | null;
  quote_detected: boolean;
  sale_detected: boolean;
  loss_detected: boolean;
  confidence: number;
  extraction_method: string;
  quality_warnings_json: string[];
  analyzed_at: string;
}
