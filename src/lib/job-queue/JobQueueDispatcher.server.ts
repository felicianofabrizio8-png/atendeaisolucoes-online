// ============================================================================
// Job Queue — Dispatcher
// Ponto único de enfileiramento. Nenhum consumidor operacional na Fase 1.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { JobQueueRepository } from "./JobQueueRepository.server";
import type { EnqueueJobInput, JobRecord } from "./JobQueueTypes";

export class JobQueueDispatcher {
  private readonly repo: JobQueueRepository;
  constructor(writer: SupabaseClient<Database>) {
    this.repo = new JobQueueRepository(writer);
  }

  enqueue(input: EnqueueJobInput): Promise<JobRecord | null> {
    return this.repo.enqueue(input);
  }
}
