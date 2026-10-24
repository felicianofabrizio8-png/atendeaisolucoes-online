import { estimateCostUsd, resolveAiPlatformConfig, type AiPlatformConfig } from "./config.server";
import { chatMessagesToResponsesInput, chatToolsToResponsesTools, responsesResultToChatCompletion } from "./compatibility.server";
import {
  AiPlatformError,
  type ChatCompatibilityRequest,
  type ChatCompatibilityResponse,
  type ResponsesRequest,
  type ResponsesResult,
} from "./types";

export interface AiUsageSink {
  record(event: {
    companyId: string;
    capability: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    estimatedCostUsd: number | null;
    latencyMs: number;
  }): Promise<void> | void;
}

interface ResponsesPayload {
  id?: unknown;
  model?: unknown;
  output?: unknown;
  output_text?: unknown;
  status?: unknown;
  incomplete_details?: { reason?: unknown } | null;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    input_tokens_details?: { cached_tokens?: unknown };
    output_tokens_details?: { reasoning_tokens?: unknown };
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type Sleep = (milliseconds: number) => Promise<void>;

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function parseResponse(payload: ResponsesPayload, modelFallback: string, latencyMs: number, attempts: number, cost: number | null): ResponsesResult {
  if (typeof payload.id !== "string" || !Array.isArray(payload.output)) {
    throw new AiPlatformError("ai_invalid_response", "OpenAI Responses response has an invalid shape");
  }
  const outputTextParts: string[] = [];
  const toolCalls: ResponsesResult["toolCalls"] = [];
  for (const item of payload.output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type === "message" && Array.isArray(record.content)) {
      for (const content of record.content) {
        if (content && typeof content === "object" && (content as Record<string, unknown>).type === "output_text") {
          const text = (content as Record<string, unknown>).text;
          if (typeof text === "string") outputTextParts.push(text);
        }
      }
    }
    if (record.type === "function_call" && typeof record.name === "string" && typeof record.arguments === "string") {
      toolCalls.push({
        callId: typeof record.call_id === "string" ? record.call_id : `${payload.id}-${toolCalls.length}`,
        name: record.name,
        arguments: record.arguments,
      });
    }
  }
  const usage = payload.usage || {};
  const outputText = typeof payload.output_text === "string" ? payload.output_text : outputTextParts.join("");
  if (!outputText.trim() && toolCalls.length === 0) {
    throw new AiPlatformError(
      "ai_invalid_response",
      "OpenAI Responses response completed without text or tool call",
    );
  }
  return {
    id: payload.id,
    model: typeof payload.model === "string" ? payload.model : modelFallback,
    outputText,
    toolCalls,
    usage: {
      inputTokens: asNumber(usage.input_tokens),
      outputTokens: asNumber(usage.output_tokens),
      cachedInputTokens: asNumber(usage.input_tokens_details?.cached_tokens),
      reasoningTokens: asNumber(usage.output_tokens_details?.reasoning_tokens),
    },
    latencyMs,
    attempts,
    estimatedCostUsd: cost,
    status: typeof payload.status === "string" ? payload.status : undefined,
    incompleteReason:
      typeof payload.incomplete_details?.reason === "string" ? payload.incomplete_details.reason : null,
  };
}

export class OpenAiResponsesGateway {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: Sleep;

  constructor(
    private readonly config: AiPlatformConfig = resolveAiPlatformConfig(),
    options: { fetchImpl?: FetchLike; sleep?: Sleep; usageSink?: AiUsageSink } = {},
  ) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.usageSink = options.usageSink;
  }

  private readonly usageSink?: AiUsageSink;

  async run(request: ResponsesRequest): Promise<ResponsesResult> {
    if (!request.companyId.trim()) throw new AiPlatformError("ai_invalid_request", "companyId is required");
    const model = request.model || this.config.models[request.capability];
    const body = {
      model,
      store: request.store ?? this.config.storeResponses,
      input: request.input,
      ...(request.instructions ? { instructions: request.instructions } : {}),
      ...(request.tools?.length ? { tools: request.tools } : {}),
      ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
      ...(request.reasoning ? { reasoning: request.reasoning } : {}),
      ...(request.responseFormat === "json"
        ? { text: { format: { type: "json_object" } } }
        : typeof request.responseFormat === "object" && request.responseFormat.type === "json_schema"
          ? { text: { format: request.responseFormat } }
          : {}),
      ...(request.maxOutputTokens ? { max_output_tokens: request.maxOutputTokens } : {}),
    };
    const startedAt = Date.now();
    let lastError: AiPlatformError | undefined;
    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs || this.config.defaultTimeoutMs);
      try {
        const response = await this.fetchImpl(this.config.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!response.ok) {
          const error = new AiPlatformError(
            response.status === 429 ? "ai_rate_limited" : "ai_provider_error",
            `OpenAI Responses request failed with status ${response.status}`,
            response.status,
            isRetryableStatus(response.status),
          );
          if (!error.retryable || attempt === this.config.retryAttempts) throw error;
          lastError = error;
          await this.sleep(200 * 2 ** (attempt - 1));
          continue;
        } else {
          const payload = (await response.json()) as ResponsesPayload;
          const latencyMs = Date.now() - startedAt;
          const usage = payload.usage || {};
          const inputTokens = asNumber(usage.input_tokens);
          const outputTokens = asNumber(usage.output_tokens);
          const result = parseResponse(payload, model, latencyMs, attempt, estimateCostUsd(model, inputTokens, outputTokens));
          await this.usageSink?.record({ companyId: request.companyId, capability: request.capability, model: result.model, inputTokens, outputTokens, reasoningTokens: result.usage.reasoningTokens, estimatedCostUsd: result.estimatedCostUsd, latencyMs });
          return result;
        }
      } catch (error) {
        clearTimeout(timeout);
        if (error instanceof AiPlatformError) {
          if (!error.retryable || attempt === this.config.retryAttempts) throw error;
          lastError = error;
        } else if (error instanceof DOMException && error.name === "AbortError") {
          lastError = new AiPlatformError("ai_timeout", "OpenAI Responses request timed out", undefined, true);
        } else {
          lastError = new AiPlatformError("ai_network", "OpenAI Responses request failed", undefined, true);
        }
        if (attempt < this.config.retryAttempts) await this.sleep(200 * 2 ** (attempt - 1));
      }
    }
    throw lastError || new AiPlatformError("ai_provider_error", "OpenAI Responses request failed");
  }

  async runChatCompatibility(request: ChatCompatibilityRequest): Promise<ChatCompatibilityResponse> {
    const converted = chatMessagesToResponsesInput(request.messages);
    const result = await this.run({
      companyId: request.companyId,
      capability: request.capability,
      model: request.model,
      instructions: converted.instructions,
      input: converted.input,
      tools: chatToolsToResponsesTools(request.tools),
      responseFormat: request.responseFormat,
      maxOutputTokens: request.maxTokens,
    });
    return responsesResultToChatCompletion(result);
  }
}
