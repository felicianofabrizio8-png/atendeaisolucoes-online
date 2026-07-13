// ============================================================================
// Billing Metrics — Types
// Somente medição. Sem Stripe, sem cobrança, sem preços.
// ============================================================================

export type BillingMetric =
  | "messages_in"
  | "messages_out"
  | "llm_calls"
  | "llm_tokens_in"
  | "llm_tokens_out"
  | "uploads_count"
  | "uploads_bytes"
  | "media_audio_seconds"
  | "media_video_seconds"
  | "media_pdf_pages"
  | "meta_calls"
  | "storage_bytes"
  | (string & {});

export interface BillingEventInput {
  companyId: string;
  metric: BillingMetric;
  value: number;
  unit?: string;
  provider?: string | null;
  occurredAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface BillingDailyAggregate {
  companyId: string;
  metric: BillingMetric;
  periodDay: string; // yyyy-mm-dd
  total: number;
}
