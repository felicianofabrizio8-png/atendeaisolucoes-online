// ============================================================================
// Billing Metrics — Service
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { BillingCollector } from "./BillingCollector.server";
import { BillingRepository } from "./BillingRepository.server";

export class BillingService {
  readonly collector: BillingCollector;
  readonly repo: BillingRepository;
  constructor(writer: SupabaseClient<Database>) {
    this.collector = new BillingCollector(writer);
    this.repo = new BillingRepository(writer);
  }
}
