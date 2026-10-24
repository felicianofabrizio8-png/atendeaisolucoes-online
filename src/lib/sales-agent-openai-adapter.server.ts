import { OpenAiResponsesGateway } from "@/lib/ai-platform/gateway.server";
import { createSupabaseAiUsageSink } from "@/lib/ai-platform/supabase-usage-sink.server";
import { AiPlatformError } from "@/lib/ai-platform/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SalesAgentCompletionRequest, SalesAgentCompletionResponse } from "./sales-agent-core";

function resolveOpenAiSalesAgentModel(requestedModel: string): string | undefined {
  const configured = process.env.AI_MODEL_SALES_AGENT?.trim() || process.env.OPENAI_MODEL?.trim();
  if (configured) return configured;
  return requestedModel.startsWith("gpt-") ? requestedModel : undefined;
}

export async function completeSalesAgentWithOpenAi(params: {
  companyId: string;
  request: SalesAgentCompletionRequest;
  modelOverride?: string;
  gateway?: Pick<OpenAiResponsesGateway, "runChatCompatibility">;
}): Promise<{ ok: true; data: SalesAgentCompletionResponse } | { ok: false; reason: string }> {
  try {
    const gateway = params.gateway ?? new OpenAiResponsesGateway(undefined, {
      usageSink: createSupabaseAiUsageSink(supabaseAdmin),
    });
    const result = await gateway.runChatCompatibility({
      companyId: params.companyId,
      capability: "sales_agent",
      model: params.modelOverride ?? resolveOpenAiSalesAgentModel(params.request.model),
      messages: params.request.messages,
      tools: params.request.tools as Array<{
        type: "function";
        function: { name: string; description?: string; parameters?: Record<string, unknown> };
      }>,
      toolChoice: "auto",
      maxTokens: params.request.max_tokens,
    });
    return { ok: true, data: result };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof AiPlatformError ? error.code : "ai_provider_error",
    };
  }
}
