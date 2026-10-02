import { createHash, randomUUID } from "node:crypto";

import type { AgentContextBase, AgentDecision } from "./sales-agent-core";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_CHARS = 4_000;
const MAX_NEXT_ACTION_CHARS = 160;
const MAX_PRODUCTS = 5;
// Folga para a ida e a volta da rede (Workers → Railway): a standalone recebe só o
// que sobra do nosso timeout e decide se ainda cabe a correção de evidências.
const NETWORK_MARGIN_MS = 1_000;
// Limite de corpo do http_api da Vendedora standalone (max_body_bytes); acima disso ela responde 400.
const MAX_REQUEST_BYTES = 1_000_000;

export type ExternalSalesAgentResult =
  | { enabled: false; reason: "disabled" | "not_silent" | "not_configured"; correlationId: string }
  | { enabled: true; ok: true; decision: AgentDecision; correlationId: string }
  | { enabled: true; ok: false; reason: "config_invalid" | "invalid_request" | "timeout" | "network_error" | "http_error" | "invalid_response"; correlationId: string };

type ExternalSalesAgentInput = {
  companyId: string;
  conversationId?: string | null;
  history: Array<{ role: "lead" | "agent" | "system"; text: string; productIds?: string[] }>;
  leadName: string | null;
  context: AgentContextBase;
  interpretation?: unknown;
  commercialState?: unknown;
  nextCatalogQuery?: unknown;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  onResult?: (result: ExternalSalesAgentResult) => void | Promise<void>;
};

type ExternalSalesAgentResponse = {
  response?: unknown;
  handoff?: unknown;
  commercial_state?: unknown;
  selected_products?: unknown;
  next_action?: unknown;
};

async function notify(input: ExternalSalesAgentInput, result: ExternalSalesAgentResult): Promise<void> {
  try { await input.onResult?.(result); } catch { /* auditoria não altera o fallback */ }
}

function configuredCompanyIds(env: Record<string, string | undefined>): Set<string> {
  return new Set((env.EXTERNAL_SALES_AGENT_COMPANY_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
}

function getConfig(env: Record<string, string | undefined>) {
  const endpoint = env.EXTERNAL_SALES_AGENT_ENDPOINT?.trim();
  const apiKey = env.EXTERNAL_SALES_AGENT_API_KEY?.trim();
  const timeoutValue = Number(env.EXTERNAL_SALES_AGENT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  let localTestEndpoint = false;
  try {
    const url = new URL(endpoint ?? "");
    localTestEndpoint = env.EXTERNAL_SALES_AGENT_ALLOW_LOCAL_HTTP_FOR_TESTS === "true"
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !localTestEndpoint) return null;
  } catch {
    return null;
  }
  const maxTimeoutMs = localTestEndpoint ? 60_000 : 10_000;
  if (!endpoint || !apiKey || !Number.isFinite(timeoutValue) || timeoutValue < 250 || timeoutValue > maxTimeoutMs) return null;
  return { endpoint, apiKey, timeoutMs: Math.floor(timeoutValue) };
}

function turnBudgetMs(timeoutMs: number): number {
  return Math.max(Math.floor(timeoutMs / 2), timeoutMs - NETWORK_MARGIN_MS);
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result ? result.slice(0, max) : null;
}

function cleanProductIds(value: unknown, allowed: Set<string>): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const ids = [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())))];
  if (ids.length > MAX_PRODUCTS || ids.some((id) => !allowed.has(id))) return null;
  return ids;
}

function cleanCommercialState(value: unknown): Record<string, string | null> | null {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const allowed = ["detected_city", "detected_state", "detected_pool_size", "detected_intent", "detected_interest", "detected_budget", "purchase_timing", "customer_stage"] as const;
  const output: Record<string, string | null> = {};
  for (const key of allowed) {
    if (source[key] === undefined) continue;
    const cleaned = cleanString(source[key], 160);
    if (source[key] !== null && cleaned === null) return null;
    output[key] = cleaned;
  }
  return output;
}

type StandaloneCatalogItem = { id: string; name: string; description: string; price: number; currency: "BRL"; category: string; available: true; source: "catalog" };

// A standalone faz Product.from_dict: float(price) e str(campo). price null → 400;
// description/category null viram o fato literal "None". Só enviamos produtos com
// preço validado; os demais ficam fora do catálogo autorizado do turno.
function toStandaloneCatalog(catalog: AgentContextBase["grounding"]["catalog"]): StandaloneCatalogItem[] {
  const items: StandaloneCatalogItem[] = [];
  for (const product of catalog) {
    const id = typeof product.id === "string" && product.id.trim() ? product.id : "";
    const name = typeof product.name === "string" ? product.name.trim() : "";
    if (!id || !name || typeof product.price !== "number" || !Number.isFinite(product.price) || product.price < 0) continue;
    items.push({
      id,
      name,
      description: typeof product.description === "string" ? product.description : "",
      price: product.price,
      currency: "BRL",
      category: typeof product.category === "string" ? product.category : "",
      available: true,
      source: "catalog",
    });
  }
  return items;
}

const STANDALONE_ROLES = { lead: "user", agent: "assistant", system: "system" } as const;

// A standalone acrescenta `message` ao histórico por conta própria, então o turno
// atual sai do history; papéis seguem o vocabulário dela (user/assistant).
function toStandaloneHistory(history: ExternalSalesAgentInput["history"], currentIndex: number) {
  return history
    .filter((item, index) => index !== currentIndex && typeof item.text === "string" && item.role in STANDALONE_ROLES)
    .slice(-40)
    .map((item) => {
      const productIds = Array.isArray(item.productIds) ? item.productIds.filter((id): id is string => typeof id === "string") : [];
      return { role: STANDALONE_ROLES[item.role], text: item.text, ...(productIds.length ? { productIds } : {}) };
    });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDecision(body: ExternalSalesAgentResponse, allowedProductIds: Set<string>): AgentDecision | null {
  const state = cleanCommercialState(body.commercial_state);
  const products = cleanProductIds(body.selected_products, allowedProductIds);
  if (!state || !products) return null;
  const handoff = body.handoff;
  const handoffRequested = typeof handoff === "boolean"
    ? handoff
    : Boolean(handoff && typeof handoff === "object" && !Array.isArray(handoff) && (handoff as Record<string, unknown>).required === true);
  const handoffReason = typeof handoff === "object" && handoff !== null && !Array.isArray(handoff)
    ? cleanString((handoff as Record<string, unknown>).reason, 200)
    : null;
  const message = cleanString(body.response, MAX_RESPONSE_CHARS);
  const nextAction = cleanString(body.next_action, MAX_NEXT_ACTION_CHARS);
  if (handoffRequested) return { kind: "handoff", reason: handoffReason ?? "external_sales_agent_handoff", suggested_products: products, next_action: nextAction, external_silent: true, ...state };
  if (!message) return null;
  return { kind: "reply", message, suggested_products: products, next_action: nextAction, external_silent: true, ...state };
}

export async function callExternalSalesAgent(input: ExternalSalesAgentInput): Promise<ExternalSalesAgentResult> {
  const env = input.env ?? process.env;
  const correlationId = randomUUID();
  if (!configuredCompanyIds(env).has(input.companyId)) {
    const result = { enabled: false as const, reason: "disabled" as const, correlationId };
    await notify(input, result);
    return result;
  }
  if (input.context.settings.sales_agent_v2_enabled !== true || input.context.settings.sales_agent_v2_mode !== "silent") {
    const result = { enabled: false as const, reason: "not_silent" as const, correlationId };
    await notify(input, result);
    return result;
  }
  const config = getConfig(env);
  if (!config) {
    const result = { enabled: true as const, ok: false as const, reason: "config_invalid" as const, correlationId };
    await notify(input, result);
    return result;
  }
  const catalog = toStandaloneCatalog(input.context.grounding.catalog);
  const allowedProducts = new Set(catalog.map((product) => product.id));
  let currentIndex = input.history.length - 1;
  while (currentIndex >= 0 && !(input.history[currentIndex].role === "lead" && typeof input.history[currentIndex].text === "string" && input.history[currentIndex].text.trim())) currentIndex -= 1;
  const message = currentIndex >= 0 ? input.history[currentIndex].text.trim() : "";
  const leadName = typeof input.leadName === "string" && input.leadName.trim() ? input.leadName.trim() : null;
  const payload = {
    company_id: input.companyId,
    message,
    history: toStandaloneHistory(input.history, currentIndex),
    lead_name: leadName,
    catalog,
    commercial_state: isPlainObject(input.commercialState) ? input.commercialState : {},
    next_catalog_query: typeof input.nextCatalogQuery === "string" ? input.nextCatalogQuery : null,
    authorized_context: {
      company_name: input.context.companyName,
      ai_profile: input.context.aiProfile,
      knowledge: input.context.knowledge,
      commercial_rules: input.context.grounding.commercialRules,
      interpretation: input.interpretation ?? null,
    },
  };
  const body = JSON.stringify(payload);
  // Pedidos que a standalone recusaria com 400 nem saem: fallback local direto.
  if (!message || new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
    const result = { enabled: true as const, ok: false as const, reason: "invalid_request" as const, correlationId };
    await notify(input, result);
    return result;
  }
  const turnFingerprint = createHash("sha256").update(JSON.stringify({ companyId: input.companyId, conversationId: input.conversationId ?? null, history: input.history })).digest("hex").slice(0, 32);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await (input.fetchImpl ?? fetch)(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
        "Idempotency-Key": `atende-ai:${input.companyId}:${input.conversationId ?? "no-conversation"}:${turnFingerprint}`,
        "X-Request-Timeout-Ms": String(turnBudgetMs(config.timeoutMs)),
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) { const result = { enabled: true as const, ok: false as const, reason: "http_error" as const, correlationId }; await notify(input, result); return result; }
    let responseBody: unknown;
    try { responseBody = await response.json(); } catch { const result = { enabled: true as const, ok: false as const, reason: "invalid_response" as const, correlationId }; await notify(input, result); return result; }
    if (!isPlainObject(responseBody)) { const result = { enabled: true as const, ok: false as const, reason: "invalid_response" as const, correlationId }; await notify(input, result); return result; }
    const decision = normalizeDecision(responseBody as ExternalSalesAgentResponse, allowedProducts);
    const result = decision ? { enabled: true as const, ok: true as const, decision, correlationId } : { enabled: true as const, ok: false as const, reason: "invalid_response" as const, correlationId };
    await notify(input, result);
    return result;
  } catch (error) {
    const result = { enabled: true as const, ok: false as const, reason: (error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network_error") as "timeout" | "network_error", correlationId };
    await notify(input, result);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
