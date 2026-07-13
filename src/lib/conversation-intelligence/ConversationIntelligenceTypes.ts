// Conversation Intelligence — Types (Fase 1, Shadow Mode)
// -----------------------------------------------------------------------------
// Contratos internos do módulo. Nenhum campo aqui pode transportar PII.
// Textos brutos de mensagens só existem em memória durante a análise; nunca
// são persistidos nem trafegam para fora do processo.

export const ANALYZER_VERSION = "det-v1.0.0" as const;

export type LifecycleStatus =
  | "in_progress"
  | "sold"
  | "lost"
  | "abandoned"
  | "completed";

export type ExtractionMethod = "deterministic" | "hybrid";

export type SentimentLabel = "positive" | "neutral" | "negative" | "mixed";

export type ProcessingStatus =
  | "pending"
  | "processing"
  | "completed"
  | "skipped"
  | "failed";

/** Mensagem simplificada — apenas metadados + texto em memória. */
export interface RawMessage {
  id: string;
  role: "lead" | "agent" | "system";
  text: string | null;
  at: string; // ISO
  source_subtype: string | null;
}

/** Snapshot da conversa carregado da camada operacional (read-only). */
export interface ConversationRaw {
  conversation_id: string;
  company_id: string;
  channel: string | null;
  lead_id: string | null;
  lead_status: string | null;
  lead_source: string | null;
  lead_closed_at: string | null;
  lead_lost_at: string | null;
  lead_estimated_value: number | null;
  quote_count: number;
  quote_last_sent_at: string | null;
  messages: RawMessage[]; // já ordenadas asc por `at`
}

export interface ConversationFactsRow {
  company_id: string;
  conversation_id: string;
  analyzer_version: string;
  content_hash: string;

  lifecycle_status: LifecycleStatus;
  primary_intent: string | null;

  intents_json: string[];
  objections_json: string[];
  buying_signals_json: string[];
  negative_signals_json: string[];
  products_json: string[];
  topics_json: string[];
  quality_warnings_json: string[];

  sentiment_label: SentimentLabel | null;
  sentiment_score: number | null;

  lead_source: string | null;
  channel: string | null;
  message_count: number;
  lead_message_count: number;
  agent_message_count: number;

  first_message_at: string | null;
  last_message_at: string | null;
  first_response_minutes: number | null;
  negotiation_duration_minutes: number | null;

  quote_detected: boolean;
  sale_detected: boolean;
  loss_detected: boolean;

  confidence: number;
  extraction_method: ExtractionMethod;

  analyzed_at: string;
}

export interface AnalyzerResult {
  facts: ConversationFactsRow;
  content_hash: string;
  skipped: boolean;
  skip_reason?: string;
}

export interface DryRunReport {
  scanned: number;
  would_process: number;
  would_skip: number;
  by_lifecycle: Record<string, number>;
  by_channel: Record<string, number>;
  low_confidence: number;
  pii_residual_suspected: number;
  errors: number;
}

export interface BackfillReport {
  scanned: number;
  processed: number;
  duplicates_skipped: number;
  low_confidence: number;
  errors: number;
  by_lifecycle: Record<string, number>;
  by_channel: Record<string, number>;
  by_intent: Record<string, number>;
  by_objection: Record<string, number>;
  by_buying_signal: Record<string, number>;
  avg_processing_ms: number;
  samples: ConversationFactsRow[]; // até 5, já sanitizados
}
