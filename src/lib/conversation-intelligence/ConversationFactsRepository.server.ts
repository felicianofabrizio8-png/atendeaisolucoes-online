// Repositório de conversation_facts. Escrita EXCLUSIVAMENTE via service_role
// em jobs server-only. Escopo restrito e sempre validando company_id.
import type { ConversationFactsRow } from "./ConversationIntelligenceTypes";

/** Insere se (company, conv, version, hash) não existir; retorna false se já existia. */
export async function upsertFactIfNew(
  row: ConversationFactsRow
): Promise<{ inserted: boolean; error?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: existing } = await supabaseAdmin
    .from("conversation_facts")
    .select("id")
    .eq("company_id", row.company_id)
    .eq("conversation_id", row.conversation_id)
    .eq("analyzer_version", row.analyzer_version)
    .eq("content_hash", row.content_hash)
    .maybeSingle();

  if (existing) return { inserted: false };

  const { error } = await supabaseAdmin.from("conversation_facts").insert({
    company_id: row.company_id,
    conversation_id: row.conversation_id,
    analyzer_version: row.analyzer_version,
    content_hash: row.content_hash,
    lifecycle_status: row.lifecycle_status,
    primary_intent: row.primary_intent,
    intents_json: row.intents_json as never,
    objections_json: row.objections_json as never,
    buying_signals_json: row.buying_signals_json as never,
    negative_signals_json: row.negative_signals_json as never,
    products_json: row.products_json as never,
    topics_json: row.topics_json as never,
    quality_warnings_json: row.quality_warnings_json as never,
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
  let q = supabaseAdmin
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
    .eq("company_id", f.companyId)
    .order("analyzed_at", { ascending: false })
    .limit(Math.min(f.limit, 50));
  if (f.lifecycle) q = q.eq("lifecycle_status", f.lifecycle);
  if (f.channel) q = q.eq("channel", f.channel);
  if (f.confidenceMin !== undefined) q = q.gte("confidence", f.confidenceMin);
  if (f.sinceDays) {
    q = q.gte("analyzed_at", new Date(Date.now() - f.sinceDays * 86400_000).toISOString());
  }
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}
