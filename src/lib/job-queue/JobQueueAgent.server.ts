// ============================================================================
// Job Queue — Agent (entry point público)
// Nenhum consumidor cadastrado nesta fase (infra "dark").
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { JobQueueService } from "./JobQueueService.server";
import type { EnqueueJobInput, JobRecord } from "./JobQueueTypes";
import type { WorkerOptions, WorkerTickResult, JobHandler } from "./JobQueueWorker.server";

export class JobQueueAgent {
  private readonly service: JobQueueService;

  constructor(writer: SupabaseClient<Database>) {
    this.service = new JobQueueService(writer);
  }

  enqueue(input: EnqueueJobInput): Promise<JobRecord | null> {
    return this.service.dispatcher.enqueue(input);
  }

  register(jobType: string, handler: JobHandler): void {
    this.service.worker.register(jobType, handler);
  }

  tick(opts: WorkerOptions): Promise<WorkerTickResult> {
    return this.service.worker.tick(opts);
  }

  pendingCount(companyId?: string): Promise<number> {
    return this.service.repo.pendingCount(companyId);
  }
}
