// ============================================================================
// Job Queue — Repository (service_role only, admin-side reads via supabase client).
// Encapsula o acesso a public.agent_jobs e às funções auxiliares
// dequeue_agent_job / complete_agent_job (SECURITY DEFINER).
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ClaimJobInput, ClaimJobResult, CompleteJobInput, DequeueOptions, EnqueueJobInput, JobRecord } from "./JobQueueTypes";

type Row = Database["public"]["Tables"]["agent_jobs"]["Row"];

function mapRow(r: Row): JobRecord {
  return {
    id: r.id,
    companyId: r.company_id,
    jobType: r.job_type,
    payload: (r.payload_json ?? {}) as Record<string, unknown>,
    priority: r.priority,
    status: r.status as JobRecord["status"],
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    lockedAt: r.locked_at,
    lockedBy: r.locked_by,
    availableAt: r.available_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    lastError: r.last_error,
    dedupeKey: r.dedupe_key,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class JobQueueRepository {
  constructor(private readonly writer: SupabaseClient<Database>) {}

  async enqueue(input: EnqueueJobInput): Promise<JobRecord | null> {
    const row = {
      company_id: input.companyId,
      job_type: input.jobType,
      payload_json: (input.payload ??
        {}) as Database["public"]["Tables"]["agent_jobs"]["Insert"]["payload_json"],
      priority: input.priority ?? 100,
      max_attempts: input.maxAttempts ?? 5,
      available_at: (input.availableAt ?? new Date()).toISOString(),
      dedupe_key: input.dedupeKey ?? null,
    };
    const { data, error } = await this.writer
      .from("agent_jobs")
      .insert(row)
      .select("*")
      .maybeSingle();
    if (error) {
      // Duplicidade por dedupe_key: retorna null (idempotente).
      if (error.code === "23505") return null;
      throw new Error(`[JobQueue.enqueue] ${error.message}`);
    }
    return data ? mapRow(data) : null;
  }

  async dequeueOne(opts: DequeueOptions): Promise<JobRecord | null> {
    const args: { _worker_id: string; _job_types: string[]; _lock_seconds: number } = {
      _worker_id: opts.workerId,
      _job_types: opts.jobTypes ?? [],
      _lock_seconds: opts.lockSeconds ?? 300,
    };
    const { data, error } = await this.writer.rpc("dequeue_agent_job", args);
    if (error) throw new Error(`[JobQueue.dequeue] ${error.message}`);
    const list = (data ?? []) as Row[];
    return list.length ? mapRow(list[0]) : null;
  }

  async complete(input: CompleteJobInput): Promise<JobRecord> {
    const args = {
      _job_id: input.jobId,
      _worker_id: input.workerId,
      _success: input.success,
      _error: input.error ?? undefined,
      _backoff_seconds: input.backoffSeconds ?? undefined,
    };
    const { data, error } = await this.writer.rpc("complete_agent_job", args);
    if (error) throw new Error(`[JobQueue.complete] ${error.message}`);
    return mapRow(data as Row);
  }

  /**
   * Reserva atômica de um job específico (por id). Diferente de `dequeueOne`,
   * usado quando o dispatcher já conhece o jobId. Retorna claim=true apenas
   * na primeira reserva; chamadas repetidas devolvem already_completed /
   * already_processing sem alterar estado.
   */
  async claim(input: ClaimJobInput): Promise<ClaimJobResult> {
    const args = {
      _job_id: input.jobId,
      _worker_id: input.workerId,
      _lock_seconds: input.lockSeconds ?? 300,
    };
    // A RPC retorna SETOF de uma linha com colunas (claimed, reason, job composite).
    const { data, error } = await (this.writer as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{
        data: Array<{ claimed: boolean; reason: string; job: Row | null }> | null;
        error: { message: string } | null;
      }>;
    }).rpc("claim_agent_job", args);
    if (error) throw new Error(`[JobQueue.claim] ${error.message}`);
    const row = (data ?? [])[0];
    if (!row) return { claimed: false, reason: "not_found", job: null };
    return {
      claimed: !!row.claimed,
      reason: row.reason,
      job: row.job ? mapRow(row.job) : null,
    };
  }

  async pendingCount(companyId?: string): Promise<number> {
    let q = this.writer
      .from("agent_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    if (companyId) q = q.eq("company_id", companyId);
    const { count, error } = await q;
    if (error) throw new Error(`[JobQueue.pendingCount] ${error.message}`);
    return count ?? 0;
  }
}
