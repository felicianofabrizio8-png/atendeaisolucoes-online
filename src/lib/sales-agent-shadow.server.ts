import type { AgentDecision, SalesAgentCompletionRequest, SalesAgentCompletionResponse } from "./sales-agent-core";
import { completeSalesAgentWithOpenAi } from "./sales-agent-openai-adapter.server";
import type { OpenAiResponsesGateway } from "@/lib/ai-platform/gateway.server";
import { estimateCostUsd } from "@/lib/ai-platform/config.server";

export function isSalesAgentShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SALES_AGENT_OPENAI_SHADOW === "enabled";
}

/** Shadow do atendimento é opt-in por empresa; a flag global sozinha não basta. */
export function isSalesAgentShadowEnabledForCompany(
  companyId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const pilotCompanyId = env.SALES_AGENT_OPENAI_SHADOW_COMPANY_ID?.trim();
  return Boolean(companyId && pilotCompanyId && isSalesAgentShadowEnabled(env) && pilotCompanyId === companyId);
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
  openAiNextAction: string | null;
  currentNextAction: string | null;
  kindMatch: boolean;
  nextActionMatch: boolean;
  memoryMatch: boolean;
  safetyRisk: boolean;
  fallback: boolean;
  reason?: string;
}

function canonicalMemory(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  try {
    return JSON.stringify({
      stage: record.stage ?? null,
      nextAction: record.nextAction ?? record.next_action ?? null,
      context: record.context ?? record.customer_context ?? null,
    });
  } catch { return null; }
}

function hasSafetyRisk(text: string): boolean {
  if (!text) return false;
  if (/\b(?:garanto|prometo|condição especial|desconto de \d|\d+\s?%|últimas unidades)\b/i.test(text)) return true;
  return /\b(?:temos|há|possui|disponível)\b[^.?!]{0,40}\bem estoque\b/i.test(text);
}

function openAiDecision(data: SalesAgentCompletionResponse): { kind: AgentDecision["kind"]; nextAction: string | null; memory: string | null; safetyRisk: boolean } | null {
  const responseMessage = data.choices?.[0]?.message;
  const call = responseMessage?.tool_calls?.[0]?.function;
  const content = typeof responseMessage?.content === "string" ? responseMessage.content.trim() : "";
  const unsafe = hasSafetyRisk(content);
  if (!call?.name || !call.arguments) {
    return content ? { kind: "reply", nextAction: null, memory: null, safetyRisk: unsafe } : null;
  }
  let args: Record<string, unknown>;
  try { args = JSON.parse(call.arguments) as Record<string, unknown>; } catch { return null; }
  const replyText = typeof args.message === "string" ? args.message : "";
  const toolUnsafe = hasSafetyRisk(replyText);
  const salesPlan = args.sales_plan && typeof args.sales_plan === "object"
    ? args.sales_plan as Record<string, unknown>
    : null;
  const nextAction = typeof args.next_action === "string"
    ? args.next_action
    : typeof salesPlan?.next_action === "string" ? salesPlan.next_action : null;
  const memory = canonicalMemory(args.sales_plan);
  if (call.name === "request_human_handoff") return { kind: "handoff", nextAction: null, memory: null, safetyRisk: toolUnsafe };
  if (call.name === "compare_catalog_prices") return { kind: "reply", nextAction: "compare_catalog_prices", memory, safetyRisk: toolUnsafe };
  return {
    kind: "reply",
    nextAction,
    memory,
    safetyRisk: toolUnsafe,
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
      openAiNextAction: null,
      currentNextAction: params.currentDecision.next_action ?? null,
      kindMatch: false,
      nextActionMatch: false,
      memoryMatch: false,
      safetyRisk: false,
      fallback: true,
      reason: result.reason,
    };
  }
  const parsed = openAiDecision(result.data);
  const currentMemory = canonicalMemory(params.currentDecision.sales_plan);
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
    openAiNextAction: openAiNextAction,
    currentNextAction: params.currentDecision.next_action ?? null,
    kindMatch: parsed?.kind === params.currentDecision.kind,
    nextActionMatch: openAiNextAction === (params.currentDecision.next_action ?? null),
    memoryMatch: parsed?.memory === currentMemory,
    safetyRisk: parsed?.safetyRisk ?? true,
    fallback: false,
  };
}
