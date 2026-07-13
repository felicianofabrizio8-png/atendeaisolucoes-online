// ============================================================================
// LLM Gateway — Retry with exponential backoff + jitter.
// ============================================================================

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: (err: unknown) => boolean;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<{ result: T; attempts: number }> {
  const max = Math.max(1, opts.maxAttempts ?? 3);
  const base = opts.baseDelayMs ?? 250;
  const cap = opts.maxDelayMs ?? 4_000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= max; attempt += 1) {
    try {
      const result = await fn(attempt);
      return { result, attempts: attempt };
    } catch (err) {
      lastErr = err;
      const retryable = opts.isRetryable ? opts.isRetryable(err) : true;
      if (!retryable || attempt >= max) break;
      const backoff = Math.min(cap, base * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * (backoff / 2));
      await new Promise((r) => setTimeout(r, backoff + jitter));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("llm_retry_exhausted");
}
