// ============================================================================
// Job Queue — Types
// Fila interna de execução assíncrona de agentes.
// Nenhum consumidor operacional nesta fase (Enterprise Hardening — Fase 1).
// ============================================================================

export type JobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "dead_letter";

export interface JobRecord {
  id: string;
  companyId: string;
  jobType: string;
  payload: Record<string, unknown>;
  priority: number;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  lockedAt: string | null;
  lockedBy: string | null;
  availableAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  dedupeKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueJobInput {
  companyId: string;
  jobType: string;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  availableAt?: Date;
  dedupeKey?: string | null;
}

export interface DequeueOptions {
  workerId: string;
  jobTypes?: string[];
  lockSeconds?: number;
}

export interface CompleteJobInput {
  jobId: string;
  workerId: string;
  success: boolean;
  error?: string | null;
  backoffSeconds?: number;
}
