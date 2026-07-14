// ============================================================================
// RuntimeJobQueue — Adaptador entre o Runtime e a Job Queue existente
// (public.agent_jobs). READ + ENQUEUE. Sem worker. Sem execução.
// Traduz JobStatus operacional → RuntimeJobStatus lógico.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { JobQueueRepository } from "@/lib/job-queue/JobQueueRepository.server";
import type { JobRecord, JobStatus } from "@/lib/job-queue/JobQueueTypes";
import { RuntimeClock } from "./RuntimeClock.server";
import {
  PRIORITY_WEIGHTS,
  type RuntimeJobCounters,
  type RuntimeJobPriority,
  type RuntimeJobRecord,
  type RuntimeJobStatus,
} from "./RuntimeTypes";

export const RUNTIME_JOB_PREFIX = "runtime:";

function toRuntimeJobType(agentId: string): string {
  return `${RUNTIME_JOB_PREFIX}${agentId}`;
}
function fromRuntimeJobType(jobType: string): string {
  return jobType.startsWith(RUNTIME_JOB_PREFIX)
    ? jobType.slice(RUNTIME_JOB_PREFIX.length)
    : jobType;
}

function priorityFromWeight(weight: number): RuntimeJobPriority {
  const entries = Object.entries(PRIORITY_WEIGHTS) as [RuntimeJobPriority, number][];
  let best: RuntimeJobPriority = "normal";
  let bestDiff = Infinity;
  for (const [k, v] of entries) {
    const diff = Math.abs(v - weight);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = k;
    }
  }
  return best;
}

function mapStatus(status: JobStatus, attempts: number, availableAtMs: number): RuntimeJobStatus {
  switch (status) {
    case "processing":
      return "processing";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "dead_letter":
      return "dead_letter";
    case "pending": {
      if (availableAtMs > RuntimeClock.now()) return "scheduled";
      if (attempts > 0) return "retry";
      return "queued";
    }
    default:
      return "queued";
  }
}

function mapRecord(r: JobRecord): RuntimeJobRecord {
  const availableAtMs = new Date(r.availableAt).getTime();
  const payloadMeta = r.payload as Record<string, unknown>;
  return {
    id: r.id,
    agentId: fromRuntimeJobType(r.jobType),
    tenantId: r.companyId,
    priority: priorityFromWeight(r.priority),
    status: mapStatus(r.status, r.attempts, availableAtMs),
    createdAt: r.createdAt,
    scheduledAt: r.availableAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    attempt: r.attempts,
    maxAttempts: r.maxAttempts,
    retryAt: r.status === "failed" && availableAtMs > RuntimeClock.now() ? r.availableAt : null,
    timeoutMs: Number(payloadMeta?.timeoutMs ?? 60_000),
    executionMode:
      (payloadMeta?.executionMode as RuntimeJobRecord["executionMode"] | undefined) ?? "queue",
    payloadHash: (payloadMeta?.payloadHash as string | null | undefined) ?? null,
    correlationId: (payloadMeta?.correlationId as string | null | undefined) ?? null,
    lastError: r.lastError,
  };
}

export interface EnqueueRuntimeJobInput {
  agentId: string;
  tenantId: string;
  priority: RuntimeJobPriority;
  executionMode: RuntimeJobRecord["executionMode"];
  timeoutMs: number;
  maxAttempts: number;
  scheduledAt?: string;
  dedupeKey?: string | null;
  correlationId?: string | null;
  payloadHash?: string | null;
}

export class RuntimeJobQueue {
  private readonly repo: JobQueueRepository;
  constructor(writer: SupabaseClient<Database>) {
    this.repo = new JobQueueRepository(writer);
    this.writer = writer;
  }
  private readonly writer: SupabaseClient<Database>;

  async enqueue(input: EnqueueRuntimeJobInput): Promise<RuntimeJobRecord | null> {
    const record = await this.repo.enqueue({
      companyId: input.tenantId,
      jobType: toRuntimeJobType(input.agentId),
      payload: {
        executionMode: input.executionMode,
        timeoutMs: input.timeoutMs,
        correlationId: input.correlationId ?? null,
        payloadHash: input.payloadHash ?? null,
      },
      priority: PRIORITY_WEIGHTS[input.priority],
      maxAttempts: input.maxAttempts,
      availableAt: input.scheduledAt ? new Date(input.scheduledAt) : new Date(),
      dedupeKey: input.dedupeKey ?? null,
    });
    return record ? mapRecord(record) : null;
  }

  async find(jobId: string): Promise<RuntimeJobRecord | null> {
    const { data, error } = await this.writer
      .from("agent_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();
    if (error) throw new Error(`[RuntimeJobQueue.find] ${error.message}`);
    if (!data) return null;
    return mapRecord({
      id: data.id,
      companyId: data.company_id,
      jobType: data.job_type,
      payload: (data.payload_json ?? {}) as Record<string, unknown>,
      priority: data.priority,
      status: data.status as JobStatus,
      attempts: data.attempts,
      maxAttempts: data.max_attempts,
      lockedAt: data.locked_at,
      lockedBy: data.locked_by,
      availableAt: data.available_at,
      startedAt: data.started_at,
      finishedAt: data.finished_at,
      lastError: data.last_error,
      dedupeKey: data.dedupe_key,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    });
  }

  async list(opts: {
    tenantId?: string;
    agentId?: string;
    status?: JobStatus[];
    limit?: number;
  } = {}): Promise<RuntimeJobRecord[]> {
    let q = this.writer.from("agent_jobs").select("*").order("created_at", { ascending: false });
    if (opts.tenantId) q = q.eq("company_id", opts.tenantId);
    if (opts.agentId) q = q.eq("job_type", toRuntimeJobType(opts.agentId));
    if (opts.status?.length) q = q.in("status", opts.status);
    q = q.limit(Math.min(opts.limit ?? 50, 200));
    const { data, error } = await q;
    if (error) throw new Error(`[RuntimeJobQueue.list] ${error.message}`);
    return (data ?? []).map((d) =>
      mapRecord({
        id: d.id,
        companyId: d.company_id,
        jobType: d.job_type,
        payload: (d.payload_json ?? {}) as Record<string, unknown>,
        priority: d.priority,
        status: d.status as JobStatus,
        attempts: d.attempts,
        maxAttempts: d.max_attempts,
        lockedAt: d.locked_at,
        lockedBy: d.locked_by,
        availableAt: d.available_at,
        startedAt: d.started_at,
        finishedAt: d.finished_at,
        lastError: d.last_error,
        dedupeKey: d.dedupe_key,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      }),
    );
  }

  async cancel(jobId: string): Promise<boolean> {
    const { error } = await this.writer
      .from("agent_jobs")
      .update({ status: "cancelled", finished_at: RuntimeClock.nowIso() })
      .eq("id", jobId)
      .eq("status", "pending");
    if (error) throw new Error(`[RuntimeJobQueue.cancel] ${error.message}`);
    return true;
  }

  async retry(jobId: string): Promise<boolean> {
    const { error } = await this.writer
      .from("agent_jobs")
      .update({
        status: "pending",
        available_at: RuntimeClock.nowIso(),
        finished_at: null,
        last_error: null,
      })
      .eq("id", jobId)
      .in("status", ["failed", "cancelled"]);
    if (error) throw new Error(`[RuntimeJobQueue.retry] ${error.message}`);
    return true;
  }

  /** Reserva atômica de um job específico. Idempotente. */
  async claim(
    jobId: string,
    workerId: string,
    lockSeconds = 300,
  ): Promise<{ claimed: boolean; reason: string }> {
    const r = await this.repo.claim({ jobId, workerId, lockSeconds });
    return { claimed: r.claimed, reason: r.reason };
  }

  /** Finaliza um job (sucesso ou falha) via RPC atômica. */
  async complete(
    jobId: string,
    workerId: string,
    success: boolean,
    error?: string | null,
    backoffSeconds?: number,
  ): Promise<void> {
    await this.repo.complete({ jobId, workerId, success, error: error ?? null, backoffSeconds });
  }

  async counters(tenantId?: string): Promise<RuntimeJobCounters> {
    const nowIso = RuntimeClock.nowIso();
    const base = () => {
      let q = this.writer.from("agent_jobs").select("id", { count: "exact", head: true });
      if (tenantId) q = q.eq("company_id", tenantId);
      return q;
    };
    const [
      pendingReady,
      pendingScheduled,
      pendingRetry,
      processing,
      completed,
      failed,
      dead,
      cancelled,
    ] = await Promise.all([
      base().eq("status", "pending").lte("available_at", nowIso).eq("attempts", 0),
      base().eq("status", "pending").gt("available_at", nowIso),
      base().eq("status", "pending").gt("attempts", 0).lte("available_at", nowIso),
      base().eq("status", "processing"),
      base().eq("status", "completed"),
      base().eq("status", "failed"),
      base().eq("status", "dead_letter"),
      base().eq("status", "cancelled"),
    ]);
    return {
      queued: pendingReady.count ?? 0,
      scheduled: pendingScheduled.count ?? 0,
      processing: processing.count ?? 0,
      completed: completed.count ?? 0,
      failed: failed.count ?? 0,
      retry: pendingRetry.count ?? 0,
      deadLetter: dead.count ?? 0,
      cancelled: cancelled.count ?? 0,
      blocked: 0, // blocked é decisão do Dispatcher (nunca persistido)
    };
  }
}

export const EMPTY_JOB_COUNTERS: RuntimeJobCounters = {
  queued: 0,
  scheduled: 0,
  processing: 0,
  completed: 0,
  failed: 0,
  retry: 0,
  deadLetter: 0,
  cancelled: 0,
  blocked: 0,
};
