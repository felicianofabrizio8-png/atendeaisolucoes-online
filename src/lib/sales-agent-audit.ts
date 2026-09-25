import type { SalesAgentMode } from "./sales-agent-mode";

export type SalesAgentAuditMode = "off" | SalesAgentMode;

export type SalesAgentAuditDecision = "skipped" | "handoff" | "reply" | "simulated" | "error";

export type SalesAgentAuditInput = {
  companyId: string;
  conversationId: string | null;
  mode: SalesAgentAuditMode;
  decision: SalesAgentAuditDecision;
  productIds?: readonly string[];
  tools?: readonly string[];
  result: string;
  blocked?: string | null;
  latencyMs: number;
  tokensAvailable?: number | null;
  fallbackReason?: string | null;
};

export type SalesAgentAuditPayload = {
  audit_kind: "sales_agent_v2";
  mode: SalesAgentAuditMode;
  decision: SalesAgentAuditDecision;
  product_ids: string[];
  tools: string[];
  result: string;
  blocked: string | null;
  latency_ms: number;
  tokens_available: number | null;
  fallback_reason?: string;
};

const SAFE_RESULT = /^[a-zA-Z0-9_.:-]{1,120}$/;

function safeCode(value: string, fallback: string): string {
  const raw = value.trim();
  if (
    /\d{8,}/.test(raw) ||
    /(?:telefone|phone|email|content|conteudo|access_token|authorization|secret|password|api[_-]?key|token)/i.test(
      raw,
    )
  )
    return fallback;
  const normalized = raw.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120);
  return SAFE_RESULT.test(normalized) ? normalized : fallback;
}

function safePositiveInteger(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

export function buildSalesAgentAuditPayload(input: SalesAgentAuditInput): SalesAgentAuditPayload {
  if (!input.companyId.trim()) throw new Error("sales_agent_audit_company_id_required");
  if (!Number.isFinite(input.latencyMs) || input.latencyMs < 0) {
    throw new Error("sales_agent_audit_latency_invalid");
  }
  const productIds = (input.productIds ?? [])
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .slice(0, 20)
    .map((id) => safeCode(id, "redacted_product"));
  const tools = (input.tools ?? [])
    .filter((tool): tool is string => typeof tool === "string" && tool.trim().length > 0)
    .slice(0, 20)
    .map((tool) => safeCode(tool, "redacted_tool"));
  return {
    audit_kind: "sales_agent_v2",
    mode: input.mode,
    decision: input.decision,
    product_ids: productIds,
    tools,
    result: safeCode(input.result, "redacted_result"),
    blocked: input.blocked ? safeCode(input.blocked, "redacted_block") : null,
    latency_ms: safePositiveInteger(input.latencyMs),
    tokens_available:
      input.tokensAvailable === null || input.tokensAvailable === undefined
        ? null
        : safePositiveInteger(input.tokensAvailable),
    ...(input.fallbackReason
      ? { fallback_reason: safeCode(input.fallbackReason, "redacted_fallback") }
      : {}),
  };
}

export function maskAuditIdentifier(value: string | null): string {
  if (!value) return "-";
  const trimmed = value.trim();
  if (trimmed.length <= 8) return "***";
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}
