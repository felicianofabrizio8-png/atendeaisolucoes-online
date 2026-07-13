// ============================================================================
// Billing Metrics — Agent
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { BillingService } from "./BillingService.server";
import type { BillingDailyAggregate, BillingEventInput } from "./BillingTypes";

export class BillingAgent {
  private readonly service: BillingService;
  constructor(writer: SupabaseClient<Database>) {
    this.service = new BillingService(writer);
  }

  record(input: BillingEventInput): Promise<void> {
    return this.service.collector.record(input);
  }

  recordMany(inputs: BillingEventInput[]): Promise<void> {
    return this.service.collector.recordMany(inputs);
  }

  aggregateDaily(companyId: string, sinceDays = 30): Promise<BillingDailyAggregate[]> {
    return this.service.repo.aggregateDaily(companyId, sinceDays);
  }
}
