import type { AiCapability } from "./types";
import { AiPlatformError } from "./types";

export interface AiPlatformConfig {
  apiKey: string;
  endpoint: string;
  defaultTimeoutMs: number;
  retryAttempts: number;
  storeResponses: boolean;
  models: Record<AiCapability, string>;
}

const capabilities: AiCapability[] = [
  "sales_agent",
  "coach",
  "followup",
  "recovery",
  "marketing",
  "executive",
  "lume",
  "copilot",
  "transcription",
  "image_generation",
];

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
}

function modelFor(capability: AiCapability, env: NodeJS.ProcessEnv): string {
  const key = `AI_MODEL_${capability.toUpperCase()}`;
  return env[key] || env.OPENAI_MODEL || "gpt-6-luna";
}

export function resolveAiPlatformConfig(
  env: NodeJS.ProcessEnv = process.env,
): AiPlatformConfig {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new AiPlatformError(
      "ai_config_missing",
      "OPENAI_API_KEY is required by the server-only AI platform",
    );
  }

  const endpoint = env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses";
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new AiPlatformError("ai_config_missing", "OPENAI_RESPONSES_URL must be a valid URL");
  }
  if (parsedEndpoint.protocol !== "https:") {
    throw new AiPlatformError("ai_config_missing", "OPENAI_RESPONSES_URL must use HTTPS");
  }

  return {
    apiKey,
    endpoint: parsedEndpoint.toString(),
    defaultTimeoutMs: positiveInt(env.AI_TIMEOUT_MS, 20_000),
    retryAttempts: Math.min(3, positiveInt(env.AI_RETRY_ATTEMPTS, 2)),
    storeResponses: booleanEnv(env.AI_STORE_RESPONSES, false),
    models: Object.fromEntries(capabilities.map((capability) => [capability, modelFor(capability, env)])) as Record<AiCapability, string>,
  };
}

export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-6.1-sol": { input: 2, output: 10 },
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "gpt-6-astra": { input: 10, output: 50 },
};

export function getModelPrice(model: string): { input: number; output: number } | null {
  return MODEL_PRICES[model] ?? null;
}

/** Worst-case cost in micro-USD for bounded input/output token counts. */
export function estimateWorstCaseCostMicroUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = getModelPrice(model);
  if (!price || !Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens) || inputTokens < 0 || outputTokens < 0) return null;
  return Math.ceil(inputTokens * price.input + outputTokens * price.output);
}

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = MODEL_PRICES[model];
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
