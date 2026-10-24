export type AiCapability =
  | "sales_agent"
  | "coach"
  | "followup"
  | "recovery"
  | "marketing"
  | "executive"
  | "lume"
  | "copilot"
  | "transcription"
  | "image_generation";

export type ChatRole = "system" | "user" | "assistant" | "developer";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatCompatibilityRequest {
  companyId: string;
  capability: AiCapability;
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ChatTool[];
  toolChoice?: "auto" | "none";
  responseFormat?: "text" | "json";
  tags?: Record<string, string>;
}

export interface ResponsesFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export interface ResponsesRequest {
  companyId: string;
  capability: AiCapability;
  model?: string;
  instructions?: string;
  input: string | Array<Record<string, unknown>>;
  tools?: ResponsesFunctionTool[];
  store?: boolean;
  timeoutMs?: number;
  maxOutputTokens?: number;
  responseFormat?: "text" | "json";
  tags?: Record<string, string>;
}

export interface AiToolCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
}

export interface ResponsesResult {
  id: string;
  model: string;
  outputText: string;
  toolCalls: AiToolCall[];
  usage: AiUsage;
  latencyMs: number;
  attempts: number;
  estimatedCostUsd: number | null;
  status?: string;
  incompleteReason?: string | null;
}

export interface ChatCompatibilityResponse {
  id: string;
  object: "chat.completion";
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: "stop" | "tool_calls";
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export type AiErrorCode =
  | "ai_config_missing"
  | "ai_invalid_request"
  | "ai_timeout"
  | "ai_network"
  | "ai_rate_limited"
  | "ai_provider_error"
  | "ai_invalid_response";

export class AiPlatformError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "AiPlatformError";
  }
}
