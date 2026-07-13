// ============================================================================
// LLM Gateway — Provider contract (client-safe types)
// Nenhum consumidor operacional na Fase 1.
// ============================================================================

export type LLMProviderName = "lovable" | "openai" | "gemini" | (string & {});

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  provider?: LLMProviderName;
  model?: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
  companyId: string;
  tags?: Record<string, string>;
}

export interface LLMResponse {
  provider: LLMProviderName;
  model: string;
  text: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  cached: boolean;
  attempts: number;
  fallbackUsed: boolean;
}

export interface LLMProvider {
  readonly name: LLMProviderName;
  execute(req: LLMRequest): Promise<LLMResponse>;
}
