// ============================================================================
// Rate Limit — Agent (entry point público, sem consumidor na Fase 1)
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  DEFAULT_POLICIES,
  RateLimitService,
  type RateLimitBucket,
  type RateLimitDecision,
  type RateLimitPolicy,
} from "./RateLimitService.server";

export class RateLimitAgent {
  private readonly service: RateLimitService;
  constructor(writer: SupabaseClient<Database>) {
    this.service = new RateLimitService(writer);
  }

  check(companyId: string, bucket: RateLimitBucket, by = 1): Promise<RateLimitDecision> {
    const policy: RateLimitPolicy = DEFAULT_POLICIES[bucket] ?? {
      bucket,
      windowSeconds: 60,
      max: 60,
    };
    return this.service.check(companyId, policy, by);
  }

  checkWithPolicy(
    companyId: string,
    policy: RateLimitPolicy,
    by = 1,
  ): Promise<RateLimitDecision> {
    return this.service.check(companyId, policy, by);
  }
}
