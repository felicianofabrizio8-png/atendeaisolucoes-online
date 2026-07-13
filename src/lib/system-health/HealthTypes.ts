// ============================================================================
// System Health — Types
// Nunca coletar PII. Somente números, tags e timestamps.
// ============================================================================

export type HealthMetric =
  | "queue_pending"
  | "queue_processing"
  | "queue_dead_letter"
  | "queue_retries_last_hour"
  | "db_latency_ms"
  | "llm_latency_ms"
  | "meta_latency_ms"
  | "storage_latency_ms"
  | "workers_active"
  | "http_errors_last_hour"
  | (string & {});

export interface HealthSampleInput {
  metric: HealthMetric;
  value: number;
  companyId?: string | null;
  tags?: Record<string, string | number | boolean>;
  collectedAt?: Date;
}

export interface HealthSnapshot {
  collectedAt: string;
  queue: {
    pending: number;
    processing: number;
    deadLetter: number;
  };
  latency: {
    db: number | null;
    llm: number | null;
    meta: number | null;
    storage: number | null;
  };
  billing: {
    llmCallsLast24h: number;
    messagesLast24h: number;
  };
}
