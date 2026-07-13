// ============================================================================
// Job Queue — Service (facade)
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { JobQueueDispatcher } from "./JobQueueDispatcher.server";
import { JobQueueRepository } from "./JobQueueRepository.server";
import { JobQueueWorker } from "./JobQueueWorker.server";

export class JobQueueService {
  readonly dispatcher: JobQueueDispatcher;
  readonly worker: JobQueueWorker;
  readonly repo: JobQueueRepository;

  constructor(writer: SupabaseClient<Database>) {
    this.dispatcher = new JobQueueDispatcher(writer);
    this.worker = new JobQueueWorker(writer);
    this.repo = new JobQueueRepository(writer);
  }
}
