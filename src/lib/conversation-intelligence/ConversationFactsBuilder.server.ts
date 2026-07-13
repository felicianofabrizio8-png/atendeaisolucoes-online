// Monta a linha de conversation_facts + calcula o content_hash irreversível.
import { createHash } from "node:crypto";
import {
  ANALYZER_VERSION,
  type ConversationFactsRow,
  type ConversationRaw,
} from "./ConversationIntelligenceTypes";
import { analyzeDeterministic } from "./DeterministicConversationAnalyzer.server";
import { sanitizeMessages } from "./ConversationSanitizer.server";

/**
 * Hash determinístico que representa a "versão relevante" da conversa,
 * SEM armazenar conteúdo — apenas IDs internos + timestamps + contagens.
 */
export function computeContentHash(raw: ConversationRaw): string {
  const h = createHash("sha256");
  h.update(ANALYZER_VERSION);
  h.update("|");
  h.update(raw.conversation_id);
  h.update("|");
  h.update(String(raw.messages.length));
  h.update("|");
  for (const m of raw.messages) {
    h.update(m.id);
    h.update(":");
    h.update(m.at);
    h.update(":");
    h.update(m.role);
    h.update(";");
  }
  h.update("|q=");
  h.update(String(raw.quote_count));
  h.update("|s=");
  h.update(raw.lead_status ?? "");
  h.update("|c=");
  h.update(raw.lead_closed_at ?? "");
  h.update("|l=");
  h.update(raw.lead_lost_at ?? "");
  return h.digest("hex");
}

export interface BuildResult {
  row: ConversationFactsRow;
  content_hash: string;
  pii_suspected: boolean;
}

export function buildFacts(raw: ConversationRaw): BuildResult {
  const contentHash = computeContentHash(raw);
  const { sanitized, pii_suspected } = sanitizeMessages(raw.messages);
  const det = analyzeDeterministic(raw, sanitized);

  const row: ConversationFactsRow = {
    company_id: raw.company_id,
    conversation_id: raw.conversation_id,
    analyzer_version: ANALYZER_VERSION,
    content_hash: contentHash,

    lifecycle_status: det.lifecycle_status,
    primary_intent: det.primary_intent,

    intents_json: det.intents,
    objections_json: det.objections,
    buying_signals_json: det.buying_signals,
    negative_signals_json: det.negative_signals,
    products_json: [], // sem vínculo estruturado ainda
    topics_json: det.topics,
    quality_warnings_json: pii_suspected
      ? [...det.quality_warnings, "pii_residual_suspected"]
      : det.quality_warnings,

    sentiment_label: det.sentiment_label,
    sentiment_score: det.sentiment_score,

    lead_source: raw.lead_source,
    channel: raw.channel,
    message_count: det.message_count,
    lead_message_count: det.lead_message_count,
    agent_message_count: det.agent_message_count,

    first_message_at: det.first_message_at,
    last_message_at: det.last_message_at,
    first_response_minutes: det.first_response_minutes,
    negotiation_duration_minutes: det.negotiation_duration_minutes,

    quote_detected: det.quote_detected,
    sale_detected: det.sale_detected,
    loss_detected: det.loss_detected,

    confidence: det.confidence,
    extraction_method: "deterministic",

    analyzed_at: new Date().toISOString(),
  };

  return { row, content_hash: contentHash, pii_suspected };
}
