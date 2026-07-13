// ============================================================================
// LLM Gateway — server-side entry point.
// Prepara a arquitetura (cache + retry + fallback + metrics + billing) sem
// obrigar consumidor a mudar. Nenhum agente é alterado na Fase 1.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { BillingCollector } from "@/lib/billing-metrics/BillingCollector.server";
import { HealthCollector } from "@/lib/system-health/HealthCollector.server";
import { LLMCache } from "./LLMCache";
import { runProviderChain } from "./LLMFallback";
import type { LLMProvider, LLMRequest, LLMResponse } from "./LLMProvider";
import { withRetry } from "./LLMRetry";

export interface GatewayOptions {
  providers: LLMProvider[];
  cache?: LLMCache;
  cacheEnabled?: boolean;
  retryAttempts?: number;
}

export class LLMGateway {
  private readonly billing: BillingCollector;
  private readonly health: HealthCollector;
  private readonly cache: LLMCache;

  constructor(
    writer: SupabaseClient<Database>,
    private readonly opts: GatewayOptions,
  ) {
    this.billing = new BillingCollector(writer);
    this.health = new HealthCollector(writer);
    this.cache = opts.cache ?? new LLMCache();
  }

  async run(req: LLMRequest): Promise<LLMResponse> {
    const cacheKey = LLMCache.key(req);
    if (this.opts.cacheEnabled !== false) {
      const hit = this.cache.get(cacheKey);
      if (hit) return hit;
    }

    const start = Date.now();
    const { result, attempts } = await withRetry(
      () => runProviderChain(this.opts.providers, req),
      {
        maxAttempts: this.opts.retryAttempts ?? 2,
        isRetryable: (err) => {
          const msg = err instanceof Error ? err.message.toLowerCase() : "";
          return (
            msg.includes("timeout") ||
            msg.includes("network") ||
            msg.includes("rate") ||
            msg.includes("5")
          );
        },
      },
    );

    const response: LLMResponse = {
      ...result.response,
      attempts,
      fallbackUsed: result.fallbackUsed,
      latencyMs: Date.now() - start,
      cached: false,
    };

    if (this.opts.cacheEnabled !== false) this.cache.set(cacheKey, response);

    void this.billing.recordMany([
      { companyId: req.companyId, metric: "llm_calls", value: 1, provider: response.provider },
      {
        companyId: req.companyId,
        metric: "llm_tokens_in",
        value: response.tokensIn,
        unit: "tokens",
        provider: response.provider,
      },
      {
        companyId: req.companyId,
        metric: "llm_tokens_out",
        value: response.tokensOut,
        unit: "tokens",
        provider: response.provider,
      },
    ]);
    void this.health.record({
      metric: "llm_latency_ms",
      value: response.latencyMs,
      companyId: req.companyId,
      tags: { provider: response.provider, model: response.model },
    });

    return response;
  }
}
