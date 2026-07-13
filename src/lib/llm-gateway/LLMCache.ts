// ============================================================================
// LLM Gateway — In-memory cache (per-worker).
// TTL curto; sem persistência entre workers. Sem PII no cache-key.
// ============================================================================

import type { LLMRequest, LLMResponse } from "./LLMProvider";

interface CacheEntry {
  expiresAt: number;
  response: LLMResponse;
}

export class LLMCache {
  private readonly store = new Map<string, CacheEntry>();
  constructor(
    private readonly ttlMs = 30_000,
    private readonly maxEntries = 200,
  ) {}

  static key(req: LLMRequest): string {
    const canonical = {
      provider: req.provider ?? "default",
      model: req.model ?? "default",
      temperature: req.temperature ?? 0,
      responseFormat: req.responseFormat ?? "text",
      messages: req.messages,
    };
    return `${req.companyId}:${hash(JSON.stringify(canonical))}`;
  }

  get(key: string): LLMResponse | null {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return { ...hit.response, cached: true };
  }

  set(key: string, response: LLMResponse): void {
    if (this.store.size >= this.maxEntries) {
      const first = this.store.keys().next().value;
      if (first) this.store.delete(first);
    }
    this.store.set(key, { expiresAt: Date.now() + this.ttlMs, response });
  }
}

function hash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
