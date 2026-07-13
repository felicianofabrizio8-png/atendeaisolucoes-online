// ============================================================================
// System Health — Collector
// Nunca falha o caller. Sem PII.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { HealthRepository } from "./HealthRepository.server";
import type { HealthSampleInput } from "./HealthTypes";

export class HealthCollector {
  private readonly repo: HealthRepository;
  constructor(writer: SupabaseClient<Database>) {
    this.repo = new HealthRepository(writer);
  }

  async record(sample: HealthSampleInput): Promise<void> {
    try {
      await this.repo.insert(sample);
    } catch (err) {
      console.error("[HealthCollector] record failed", err);
    }
  }

  async recordMany(samples: HealthSampleInput[]): Promise<void> {
    try {
      await this.repo.insertMany(samples);
    } catch (err) {
      console.error("[HealthCollector] recordMany failed", err);
    }
  }

  async time<T>(metric: string, fn: () => Promise<T>, companyId?: string): Promise<T> {
    const start = Date.now();
    try {
      const value = await fn();
      await this.record({
        metric,
        value: Date.now() - start,
        companyId: companyId ?? null,
        tags: { outcome: "ok" },
      });
      return value;
    } catch (err) {
      await this.record({
        metric,
        value: Date.now() - start,
        companyId: companyId ?? null,
        tags: { outcome: "error" },
      });
      throw err;
    }
  }
}
