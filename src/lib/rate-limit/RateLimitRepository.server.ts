// ============================================================================
// Rate Limit — Repository
// Encapsula rate_limit_counters + função rate_limit_increment (SECURITY DEFINER).
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface RateLimitBucketKey {
  companyId: string;
  bucket: string;
  windowSeconds: number;
}

export class RateLimitRepository {
  constructor(private readonly writer: SupabaseClient<Database>) {}

  static currentWindowStart(windowSeconds: number, now: Date = new Date()): Date {
    const ms = windowSeconds * 1000;
    return new Date(Math.floor(now.getTime() / ms) * ms);
  }

  async increment(key: RateLimitBucketKey, by = 1): Promise<number> {
    const windowStart = RateLimitRepository.currentWindowStart(key.windowSeconds);
    const { data, error } = await this.writer.rpc("rate_limit_increment", {
      _company_id: key.companyId,
      _bucket: key.bucket,
      _window_start: windowStart.toISOString(),
      _window_seconds: key.windowSeconds,
      _increment: by,
    });
    if (error) throw new Error(`[RateLimit.increment] ${error.message}`);
    return Number(data ?? 0);
  }

  async peek(key: RateLimitBucketKey): Promise<number> {
    const windowStart = RateLimitRepository.currentWindowStart(key.windowSeconds);
    const { data, error } = await this.writer
      .from("rate_limit_counters")
      .select("count")
      .eq("company_id", key.companyId)
      .eq("bucket", key.bucket)
      .eq("window_seconds", key.windowSeconds)
      .eq("window_start", windowStart.toISOString())
      .maybeSingle();
    if (error) throw new Error(`[RateLimit.peek] ${error.message}`);
    return Number(data?.count ?? 0);
  }
}
