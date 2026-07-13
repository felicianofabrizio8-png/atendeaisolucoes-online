// ============================================================================
// LLM Gateway — Fallback provider chain.
// ============================================================================

import type { LLMProvider, LLMRequest, LLMResponse } from "./LLMProvider";

export async function runProviderChain(
  providers: LLMProvider[],
  req: LLMRequest,
): Promise<{ response: LLMResponse; fallbackUsed: boolean }> {
  if (!providers.length) throw new Error("no_llm_providers_configured");
  let lastErr: unknown;
  for (let i = 0; i < providers.length; i += 1) {
    try {
      const response = await providers[i].execute(req);
      return { response, fallbackUsed: i > 0 };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("llm_all_providers_failed");
}
