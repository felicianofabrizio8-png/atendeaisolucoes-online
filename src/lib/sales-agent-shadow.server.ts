import type { AgentDecision, SalesAgentCompletionRequest, SalesAgentCompletionResponse } from "./sales-agent-core";
import { completeSalesAgentWithOpenAi } from "./sales-agent-openai-adapter.server";
import type { OpenAiResponsesGateway } from "@/lib/ai-platform/gateway.server";
import { estimateCostUsd } from "@/lib/ai-platform/config.server";

export function isSalesAgentShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SALES_AGENT_OPENAI_SHADOW === "enabled";
}

export interface SalesAgentShadowReport {
  companyId: string;
  ok: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
  openAiKind: AgentDecision["kind"] | null;
  currentKind: AgentDecision["kind"];
  kindMatch: boolean;
  nextActionMatch: boolean;
  memoryMatch: boolean;
  safetyRisk: boolean;
  fallback: boolean;
  reason?: string;
}

function openAiDecision(data: SalesAgentCompletionResponse): { kind: AgentDecision["kind"]; nextAction: string | null; memory: string | null; safetyRisk: boolean } | null {
  const call = data.choices?.[0]?.message?.tool_calls?.[0]?.function;
  if (!call?.name || !call.arguments) return null;
  let args: Record<string, unknown>;
  try { args = JSON.parse(call.arguments) as Record<string, unknown>; } catch { return null; }
  const message = typeof args.message === "string" ? args.message : "";
  const unsafe = /\b(?:garanto|prometo|condição especial|desconto de \d|\d+\s?%|últimas unidades|em estoque)\b/i.test(message);
  if (call.name === "request_human_handoff") return { kind: "handoff", nextAction: null, memory: null, safetyRisk: unsafe };
  if (call.name === "compare_catalog_prices") return { kind: "reply", nextAction: "compare_catalog_prices", memory: typeof args.sales_plan === "string" ? args.sales_plan : null, safetyRisk: unsafe };
  return {
    kind: "reply",
    nextAction: typeof args.next_action === "string" ? args.next_action : null,
    memory: typeof args.sales_plan === "string" ? args.sales_plan : null,
    safetyRisk: unsafe,
  };
}

export async function runSalesAgentShadow(params: {
  companyId: string;
  request: SalesAgentCompletionRequest;
  currentDecision: AgentDecision;
  gateway?: Pick<OpenAiResponsesGateway, "runChatCompatibility">;
}): Promise<SalesAgentShadowReport> {
  const startedAt = Date.now();
  const result = await completeSalesAgentWithOpenAi({ companyId: params.companyId, request: params.request, gateway: params.gateway });
  if (!result.ok) {
    return {
      companyId: params.companyId,
      ok: false,
      latencyMs: Date.now() - startedAt,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: null,
      openAiKind: null,
      currentKind: params.currentDecision.kind,
      kindMatch: false,
      nextActionMatch: false,
      memoryMatch: false,
      safetyRisk: false,
      fallback: true,
      reason: result.reason,
    };
  }
  const parsed = openAiDecision(result.data);
  const currentMemory = params.currentDecision.sales_plan ? JSON.stringify(params.currentDecision.sales_plan) : null;
  const usage = result.data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  const openAiNextAction = parsed?.nextAction ?? null;
  return {
    companyId: params.companyId,
    ok: Boolean(parsed),
    latencyMs: Date.now() - startedAt,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    estimatedCostUsd: estimateCostUsd(result.data.model ?? params.request.model, usage.prompt_tokens, usage.completion_tokens),
    openAiKind: parsed?.kind ?? null,
    currentKind: params.currentDecision.kind,
    kindMatch: parsed?.kind === params.currentDecision.kind,
    nextActionMatch: openAiNextAction === (params.currentDecision.next_action ?? null),
    memoryMatch: parsed?.memory === currentMemory,
    safetyRisk: parsed?.safetyRisk ?? true,
    fallback: false,
  };
}
