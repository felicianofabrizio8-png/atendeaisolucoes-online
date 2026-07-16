// Marketing Publisher — types
// Fase 2 aditiva. Módulo isolado; não altera Marketing IA/Learning Loop/etc.

export type PublicationChannel = "instagram" | "facebook";
export type PublicationFormat = "feed" | "reel" | "story";
export type PublicationStatus =
  | "queued"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

export interface AttemptEntry {
  at: string;
  outcome: "success" | "error" | "retry" | "simulated";
  error_code?: string;
  error_message?: string;
  platform_post_id?: string;
  simulated?: boolean;
}

export interface PublicationRow {
  id: string;
  company_id: string;
  schedule_id: string;
  content_id: string;
  channel: PublicationChannel;
  format: PublicationFormat;
  status: PublicationStatus;
  platform_post_id: string | null;
  platform_response: unknown;
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
  attempt_log: AttemptEntry[];
  locked_by: string | null;
  locked_at: string | null;
  available_at: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublisherStats {
  scheduled: number;
  queued: number;
  publishing: number;
  published: number;
  failed: number;
  cancelled: number;
}

export const MAX_RETRIES = 3;
export const RETRYABLE_ERROR_CODES = new Set([
  "network_error",
  "http_5xx",
  "rate_limited",
  "container_not_ready",
  "temporary_error",
]);
