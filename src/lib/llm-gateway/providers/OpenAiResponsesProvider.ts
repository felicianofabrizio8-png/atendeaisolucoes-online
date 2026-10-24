// Compatibility adapter for legacy LLMGateway consumers.
// Server-only: delegates to the validated Responses API gateway and does not
// change existing provider selection by itself.
import { OpenAiResponsesGateway } from "@/lib/ai-platform/gateway.server";
import { chatMessagesToResponsesInput, responsesResultToChatCompletion } from "@/lib/ai-platform/compatibility.server";
import type { AiCapability } from "@/lib/ai-platform/types";
import type { LLMProvider, LLMRequest, LLMResponse } from "../LLMProvider";

export interface OpenAiResponsesProviderOptions {
  gateway?: OpenAiResponsesGateway;
  defaultModel?: string;
  capability?: AiCapability;
}

export class OpenAiResponsesProvider implements LLMProvider {
  readonly name = "openai" as const;
  private readonly gateway: OpenAiResponsesGateway;
  private readonly defaultModel?: string;
  private readonly capability: AiCapability;

  constructor(options: OpenAiResponsesProviderOptions = {}) {
    this.gateway = options.gateway ?? new OpenAiResponsesGateway();
    this.defaultModel = options.defaultModel;
    this.capability = options.capability ?? "followup";
  }

  async execute(req: LLMRequest): Promise<LLMResponse> {
    const converted = chatMessagesToResponsesInput(req.messages);
    const result = await this.gateway.run({
      companyId: req.companyId,
      capability: this.capability,
      model: req.model ?? this.defaultModel,
      instructions: converted.instructions,
      input: converted.input,
      maxOutputTokens: req.maxTokens,
      responseFormat: req.responseFormat,
      store: false,
      tags: req.tags,
    });
    const completion = responsesResultToChatCompletion(result);
    return {
      provider: this.name,
      model: completion.model,
      text: completion.choices[0]?.message.content ?? "",
      tokensIn: completion.usage.prompt_tokens,
      tokensOut: completion.usage.completion_tokens,
      latencyMs: result.latencyMs,
      cached: false,
      attempts: result.attempts,
      fallbackUsed: false,
    };
  }
}
