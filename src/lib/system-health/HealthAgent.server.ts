// ============================================================================
// System Health — Agent
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { HealthService } from "./HealthService.server";
import type { HealthSampleInput, HealthSnapshot } from "./HealthTypes";

export class HealthAgent {
  private readonly service: HealthService;
  constructor(writer: SupabaseClient<Database>) {
    this.service = new HealthService(writer);
  }

  snapshot(companyId?: string): Promise<HealthSnapshot> {
    return this.service.snapshot(companyId);
  }

  record(sample: HealthSampleInput): Promise<void> {
    return this.service.collector.record(sample);
  }
}
