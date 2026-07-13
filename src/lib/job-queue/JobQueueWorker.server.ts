// ============================================================================
// Job Queue — Worker
// Worker determinístico. Nunca executa dois jobs iguais ao mesmo tempo
// (garantido pelo FOR UPDATE SKIP LOCKED em dequeue_agent_job).
// Nenhum handler operacional cadastrado na Fase 1.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { JobQueueRepository } from "./JobQueueRepository.server";
import type { JobRecord } from "./JobQueueTypes";

export type JobHandler = (job: JobRecord) => Promise<void>;

export interface WorkerOptions {
  workerId: string;
  jobTypes?: string[];
  lockSeconds?: number;
  maxJobsPerTick?: number;
  timeoutMs?: number;
}

export interface WorkerTickResult {
  processed: number;
  succeeded: number;
  failed: number;
  emptyDequeues: number;
}

export class JobQueueWorker {
  private readonly repo: JobQueueRepository;
  private readonly handlers = new Map<string, JobHandler>();

  constructor(writer: SupabaseClient<Database>) {
    this.repo = new JobQueueRepository(writer);
  }

  register(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
  }

  hasHandler(jobType: string): boolean {
    return this.handlers.has(jobType);
  }

  async tick(opts: WorkerOptions): Promise<WorkerTickResult> {
    const result: WorkerTickResult = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      emptyDequeues: 0,
    };
    const budget = Math.max(1, opts.maxJobsPerTick ?? 5);

    for (let i = 0; i < budget; i += 1) {
      const job = await this.repo.dequeueOne({
        workerId: opts.workerId,
        jobTypes: opts.jobTypes,
        lockSeconds: opts.lockSeconds ?? 300,
      });
      if (!job) {
        result.emptyDequeues += 1;
        break;
      }
      result.processed += 1;
      try {
        const handler = this.handlers.get(job.jobType);
        if (!handler) {
          await this.repo.complete({
            jobId: job.id,
            workerId: opts.workerId,
            success: false,
            error: `no_handler_registered:${job.jobType}`,
          });
          result.failed += 1;
          continue;
        }
        await this.runWithTimeout(handler(job), opts.timeoutMs ?? 60_000);
        await this.repo.complete({
          jobId: job.id,
          workerId: opts.workerId,
          success: true,
        });
        result.succeeded += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown_error";
        await this.repo.complete({
          jobId: job.id,
          workerId: opts.workerId,
          success: false,
          error: message.slice(0, 500),
        });
        result.failed += 1;
      }
    }

    return result;
  }

  private async runWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let handle: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        p,
        new Promise<T>((_, reject) => {
          handle = setTimeout(() => reject(new Error(`job_timeout_${ms}ms`)), ms);
        }),
      ]);
    } finally {
      if (handle) clearTimeout(handle);
    }
  }
}
