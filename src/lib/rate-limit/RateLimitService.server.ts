// ============================================================================
// Rate Limit — Service
// Camada de decisão. Retorna allowed/denied sem lançar erros.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { RateLimitRepository } from "./RateLimitRepository.server";

export type RateLimitBucket =
  | "llm"
  | "meta"
  | "whatsapp"
  | "instagram"
  | "facebook"
  | "upload"
  | "public_webhook"
  | (string & {});

export interface RateLimitPolicy {
  bucket: RateLimitBucket;
  windowSeconds: number;
  max: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  current: number;
  max: number;
  windowSeconds: number;
  retryAfterSeconds: number;
}

// Políticas conservadoras (podem ser tunadas depois sem alterar consumidor).
export const DEFAULT_POLICIES: Record<string, RateLimitPolicy> = {
  llm: { bucket: "llm", windowSeconds: 60, max: 60 },
  llm_daily: { bucket: "llm_daily", windowSeconds: 86_400, max: 5_000 },
  meta: { bucket: "meta", windowSeconds: 60, max: 120 },
  whatsapp: { bucket: "whatsapp", windowSeconds: 60, max: 120 },
  instagram: { bucket: "instagram", windowSeconds: 60, max: 60 },
  facebook: { bucket: "facebook", windowSeconds: 60, max: 60 },
  upload: { bucket: "upload", windowSeconds: 60, max: 60 },
  public_webhook: { bucket: "public_webhook", windowSeconds: 60, max: 600 },
};

export class RateLimitService {
  private readonly repo: RateLimitRepository;
  constructor(writer: SupabaseClient<Database>) {
    this.repo = new RateLimitRepository(writer);
  }

  async check(companyId: string, policy: RateLimitPolicy, by = 1): Promise<RateLimitDecision> {
    const current = await this.repo.increment(
      { companyId, bucket: policy.bucket, windowSeconds: policy.windowSeconds },
      by,
    );
    const allowed = current <= policy.max;
    return {
      allowed,
      current,
      max: policy.max,
      windowSeconds: policy.windowSeconds,
      retryAfterSeconds: allowed ? 0 : policy.windowSeconds,
    };
  }
}
