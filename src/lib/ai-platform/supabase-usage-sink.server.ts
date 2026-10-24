import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { BillingCollector } from "@/lib/billing-metrics/BillingCollector.server";
import { HealthCollector } from "@/lib/system-health/HealthCollector.server";
import type { AiUsageSink } from "./gateway.server";

/** Persiste somente contadores e dimensões técnicas; nunca prompts, respostas ou PII. */
export function createSupabaseAiUsageSink(writer: SupabaseClient<Database>): AiUsageSink {
  const billing = new BillingCollector(writer);
  const health = new HealthCollector(writer);
  return {
    async record(event) {
      const metadata = { capability: event.capability, model: event.model };
      const usage = [
        { companyId: event.companyId, metric: "llm_calls", value: 1, provider: "openai", metadata },
        { companyId: event.companyId, metric: "llm_tokens_in", value: event.inputTokens, unit: "tokens", provider: "openai", metadata },
        { companyId: event.companyId, metric: "llm_tokens_out", value: event.outputTokens, unit: "tokens", provider: "openai", metadata },
        ...(event.estimatedCostUsd === null ? [] : [{
          companyId: event.companyId,
          metric: "llm_cost_microusd",
          value: Math.round(event.estimatedCostUsd * 1_000_000),
          unit: "micro_usd",
          provider: "openai",
          metadata,
        }]),
      ];
      await billing.recordMany(usage);
      await health.record({ metric: "llm_latency_ms", value: event.latencyMs, companyId: event.companyId, tags: metadata });
    },
  };
}
