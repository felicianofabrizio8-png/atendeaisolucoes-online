// ============================================================================
// LLM Gateway — Metrics helpers (pure, client-safe)
// ============================================================================

import type { LLMResponse } from "./LLMProvider";

export interface LLMMetricRecord {
  provider: string;
  model: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  attempts: number;
  fallbackUsed: boolean;
  cached: boolean;
}

export function toMetricRecord(res: LLMResponse): LLMMetricRecord {
  return {
    provider: res.provider,
    model: res.model,
    latencyMs: res.latencyMs,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    attempts: res.attempts,
    fallbackUsed: res.fallbackUsed,
    cached: res.cached,
  };
}
