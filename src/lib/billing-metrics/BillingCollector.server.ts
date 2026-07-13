// ============================================================================
// Billing Metrics — Collector
// Ponto único usado por futuros consumidores (LLM Gateway, upload pipeline, etc.).
// Nunca falha o caller: erros são logados e engolidos.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { BillingRepository } from "./BillingRepository.server";
import type { BillingEventInput } from "./BillingTypes";

export class BillingCollector {
  private readonly repo: BillingRepository;
  constructor(writer: SupabaseClient<Database>) {
    this.repo = new BillingRepository(writer);
  }

  async record(input: BillingEventInput): Promise<void> {
    try {
      await this.repo.record(input);
    } catch (err) {
      console.error("[BillingCollector] record failed", err);
    }
  }

  async recordMany(inputs: BillingEventInput[]): Promise<void> {
    try {
      await this.repo.recordMany(inputs);
    } catch (err) {
      console.error("[BillingCollector] recordMany failed", err);
    }
  }
}
