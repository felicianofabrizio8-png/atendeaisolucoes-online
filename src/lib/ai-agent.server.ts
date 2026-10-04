// ============================================================================
// AI Agent — Phase 1 engine (server-only, sem alterar meta-send/meta-webhook)
// ============================================================================
// Usado por:
//   - POST /api/public/hooks/agent-trigger  (disparado pelo trigger postgres)
//   - POST /api/ai/agent-tick               (cron + chamadas internas)
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { postGraph } from "@/lib/outbound/MetaOutbound.server";
import { isSimulation, isRealDelivery } from "@/lib/outbound/MetaOutboundContract";
import {
  detectObjections,
  detectReadyToClose,
  normalizeState,
  computeLeadScore,
  temperatureFromScore,
  mergeObjections,
  type Objection,
  type CustomerStage,
  type PurchaseTiming,
  type Temperature,
} from "./ai-qualifier.server";
import {
  SalesAgentCore,
  customerAskedAboutProducts,
  customerAskedForProductImages,
  type AgentContext,
  type AgentContextBase,
  type SalesAgentCatalogSearch,
  type AgentDecision,
  type AgentSettings,
} from "./sales-agent-core";
import {
  loadRelevantSalesAgentQuickReplies,
  loadRelevantSalesAgentLearnings,
  loadSalesAgentGrounding,
  extractCurrentProductAttributes,
  filterProductsByStructuredAttributes,
  searchSalesAgentCatalog,
  selectRelevantSalesAgentCoachRules,
  type AgentHistory,
  type CatalogSearchOptions,
  type ProductSelectionContext,
} from "./sales-agent-grounding.server";
import {
  mergeConversationSalesState,
} from "./conversation-sales-state";
import {
  loadConversationSalesState,
  revalidateConversationSalesState,
  saveConversationSalesState,
  type ConversationSalesStateScope,
} from "./conversation-sales-state.server";
import type { ConversationSalesState } from "./conversation-sales-state";
import { listActiveCoachRulesForGrounding } from "./coach-rules/coach-rules.repository";
import { SALES_AGENT_PLAYBOOK } from "./sales-agent-playbook";
import { safeTimeZone, zonedParts } from "./followup/calendar";
import { resolveInstitutionalPolicies } from "./sales-agent-institutional";
import { getConversationFocusProductIds, withConversationFocus } from "./sales-agent-focus";
import {
  customerContextFromEventPayload,
  mergeCustomerContext,
  type CustomerContext,
} from "./sales-agent-intelligence";
import { resolveWhatsappSendCredentials } from "./whatsapp/send-credentials";
import { resolveSalesAgentLlmConfig } from "./sales-agent-config.server";
import { sendWhatsappProductImages } from "./sales-agent-product-images.server";
import { callExternalSalesAgent, type ExternalSalesAgentResult } from "./external-sales-agent-adapter.server";
import { externalSalesAgentBudgetMs, internalLlmTimeoutMs } from "./agent-turn-budget";
import { MAX_SALES_AGENT_PRODUCT_IMAGES } from "./sales-agent-product-images";
import { canSalesAgentSend, resolveSalesAgentMode, type SalesAgentMode } from "./sales-agent-mode";
import { AUDIO_UNAVAILABLE_REPLY, classifyLeadAudio, isAudioPlaceholder } from "./sales-agent-media";
import { resolveSalesAgentNormativeContext } from "./sales-agent-normative-resolver";
import { buildSalesAgentAuditPayload, type SalesAgentAuditDecision, type SalesAgentAuditMode } from "./sales-agent-audit";
import { authorizeSalesAgentReply } from "./sales-agent-execution";
import { buildPendingAssistedSuggestion } from "./sales-agent-assisted";
import type { NormativeCorrection } from "./sales-agent-normative-resolver";
import {
  prepareSalesAgentAction,
  validateSalesAgentCatalog,
} from "./sales-agent-v2-tools";
import {
  buildCompactSalesContextSummary,
  interpretStructuredSalesTurn,
  type StructuredSalesAgentInterpretation,
} from "./sales-agent-interpretation";

export type { AgentContext, AgentDecision, AgentSettings } from "./sales-agent-core";
export type { AgentContextBase } from "./sales-agent-core";

export interface SalesAgentTurnInterpretation {
  intent: "product_images" | "product_inquiry" | null;
  attributes: ReturnType<typeof extractCurrentProductAttributes>;
  references: { lastLeadText: string; productIds: string[] };
  structured: StructuredSalesAgentInterpretation;
  history: AgentHistory;
}

/** Stage 1: interpret the request without reading or deriving product facts. */
export function interpretSalesAgentTurn(
  history: AgentHistory,
): SalesAgentTurnInterpretation {
  const lastLeadText = [...history].reverse().find((item) => item.role === "lead")?.text ?? "";
  return {
    intent: customerAskedForProductImages(history)
      ? "product_images"
      : customerAskedAboutProducts(history)
        ? "product_inquiry"
        : null,
    structured: interpretStructuredSalesTurn(history),
    attributes: extractCurrentProductAttributes(history),
    references: {
      lastLeadText,
      productIds: history.flatMap((item) => item.productIds ?? []),
    },
    history,
  };
}

function isContextualSalesAgentTurn(history: AgentHistory): boolean {
  const text = [...history].reverse().find((item) => item.role === "lead")?.text ?? "";
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const pronoun = /\b(?:essa|esse|esta|este|isso|isso|dessa|desse|desta|deste|ela|ele|dela|dele|nessa|nesse)\b/.test(normalized);
  const ordinal = /\b(?:primeira?|segundo?|ultima?|ultimo|1a|1o|2a|2o)\b/.test(normalized);
  const continuation = /^(?:(?:e|tem)\s+)?(?:mais(?:\s+(?:algum|alguma|um|uma|produto|modelo))?|outro\s+modelo|outras?\s+(?:opcoes?|alternativas?)|e\s+mais\s+algum)\b/.test(normalized);
  return pronoun || ordinal || continuation;
}

function reconcileHistoricalProductIds(
  history: AgentHistory,
  allowedProductIds: ReadonlySet<string>,
  clearAll = false,
): AgentHistory {
  return history.map(({ productIds, ...item }) => {
    const validIds = clearAll
      ? []
      : (productIds ?? []).filter((id) => allowedProductIds.has(id));
    return validIds.length > 0 ? { ...item, productIds: [...new Set(validIds)] } : item;
  });
}

type CanonicalCatalogProduct = AgentContextBase["grounding"]["catalog"][number];

function mapValidatedCatalogProduct(row: unknown, companyId: string): CanonicalCatalogProduct | null {
  if (!row || typeof row !== "object") return null;
  const source = row as Record<string, unknown>;
  const rowCompanyId = source.company_id ?? source.companyId;
  if (rowCompanyId !== undefined && rowCompanyId !== companyId) return null;
  if (source.active !== undefined && source.active !== true) return null;
  const id = typeof source.id === "string" ? source.id : "";
  const name = typeof source.name === "string" ? source.name : "";
  if (!id || !name) return null;
  const stringOrNull = (snake: string, camel: string): string | null => {
    const value = source[snake] ?? source[camel];
    return typeof value === "string" ? value : null;
  };
  const numberOrNull = (snake: string, camel: string): number | null => {
    const value = source[snake] ?? source[camel];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const arrayOfStrings = (snake: string, camel: string): string[] => {
    const value = source[snake] ?? source[camel];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  };
  return {
    id,
    name,
    model: stringOrNull("model", "model"),
    sku: stringOrNull("sku", "sku"),
    category: stringOrNull("category", "category"),
    description: stringOrNull("description", "description"),
    lengthM: numberOrNull("length_m", "lengthM"),
    widthM: numberOrNull("width_m", "widthM"),
    depthM: numberOrNull("depth_m", "depthM"),
    capacityL: numberOrNull("capacity_l", "capacityL"),
    shape: stringOrNull("shape", "shape"),
    specifications:
      source.specifications && typeof source.specifications === "object" && !Array.isArray(source.specifications)
        ? source.specifications
        : {},
    includedItems: arrayOfStrings("included_items", "includedItems"),
    variants: Array.isArray(source.variants)
      ? source.variants.filter((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      : [],
    price: numberOrNull("price", "price"),
    promoPrice: numberOrNull("promo_price", "promoPrice"),
    images: arrayOfStrings("images", "images"),
    notes: stringOrNull("notes", "notes"),
  };
}

async function loadServerValidatedCatalog(companyId: string): Promise<CanonicalCatalogProduct[] | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select("id, name, model, sku, category, description, length_m, width_m, depth_m, capacity_l, shape, specifications, included_items, variants, price, promo_price, images, notes")
      .eq("company_id", companyId)
      .eq("active", true)
      .order("name", { ascending: true });
    if (error || !Array.isArray(data)) return null;
    return data
      .map((row) => mapValidatedCatalogProduct(row, companyId))
      .filter((product): product is CanonicalCatalogProduct => product !== null);
  } catch {
    return null;
  }
}

function restrictContextToActiveTenantCatalog(
  ctx: AgentContextBase,
  catalog: CanonicalCatalogProduct[],
): AgentContextBase {
  return {
    ...ctx,
    catalogProductIds: catalog.map((product) => product.id),
    products: catalog,
    catalogForValidation: catalog,
    grounding: { ...ctx.grounding, catalog },
  };
}

async function saveSalesStateSafely(
  scope: ConversationSalesStateScope,
  state: ConversationSalesState,
): Promise<void> {
  try {
    await saveConversationSalesState(scope, state);
  } catch (error) {
    console.warn("[SALES_AGENT_STATE_SAVE_FAILED]", {
      source: "conversation_sales_state",
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/** Stage 2: execute the canonical deterministic catalog tool for this turn. */
export function resolveSalesAgentCatalogSearch(
  interpretation: SalesAgentTurnInterpretation,
  context: {
    grounding: Pick<AgentContext["grounding"], "catalog" | "catalogScope">;
  },
  salesState: ConversationSalesState | null = null,
  options: CatalogSearchOptions = {},
): SalesAgentCatalogSearch {
  const scope = context.grounding.catalogScope;
  if (!scope) return { status: "query_error", error: new Error("catalog_scope_missing") };
  if (options.continuityEnabled) {
    const catalogValidation = validateSalesAgentCatalog({
      companyId: scope.companyId,
      scope,
      catalog: context.grounding.catalog,
    });
    if (!catalogValidation.ok) return { status: "query_error", error: new Error(catalogValidation.code) };
  }
  return searchSalesAgentCatalog(
    scope.companyId,
    context.grounding.catalog,
    interpretation.history,
    salesState,
    scope,
    options,
  );
}

/** Stage 4: communicate only the already validated decision. */
export function redactSalesAgentDecision(decision: AgentDecision): AgentDecision {
  return decision.kind === "reply" && typeof decision.message === "string"
    ? { ...decision, message: decision.message.trim() }
    : { ...decision };
}

const GATEWAY_ERROR_FIELDS = ["type", "code", "param", "message"] as const;

function sanitizeGatewayErrorValue(value: unknown, apiKey: string): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  let safe = String(value)
    .replace(/[\r\n\t]+/g, " ")
    .trim();
  if (!safe) return undefined;
  if (apiKey) safe = safe.split(apiKey).join("[redacted]");
  safe = safe
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|key)-[A-Za-z0-9_-]{12,}\b/gi, "[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]");
  return safe.slice(0, 400);
}

function parseGatewayErrorDiagnostic(raw: string, apiKey: string): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const nested = parsed.error;
    const source =
      nested && typeof nested === "object" && !Array.isArray(nested)
        ? (nested as Record<string, unknown>)
        : parsed;
    const diagnostic: Record<string, string> = {};
    for (const field of GATEWAY_ERROR_FIELDS) {
      const value = sanitizeGatewayErrorValue(source[field], apiKey);
      if (value) diagnostic[field] = value;
    }
    return diagnostic;
  } catch {
    return {};
  }
}

// ----------------------------------------------------------------------------
// Tipos
// ----------------------------------------------------------------------------

export interface AgentConversation {
  id: string;
  company_id: string;
  lead_id: string;
  channel: string;
  ai_handling: boolean;
  ai_status: string | null;
  auto_reply_count: number;
  last_auto_reply_at: string | null;
  human_takeover_at: string | null;
}

export type SkipReason =
  | "disabled"
  | "business_hours"
  | "human_active"
  | "rate_limit"
  | "human_pending"
  | "already_answered"
  | "lock_busy"
  | "no_lead_message"
  | "missing_integration"
  | "missing_ai_profile"
  | "no_whatsapp_integration";

// ----------------------------------------------------------------------------
// Logging
// ----------------------------------------------------------------------------

export async function logEvent(
  companyId: string,
  conversationId: string | null,
  leadId: string | null,
  event_type: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabaseAdmin.from("ai_flow_events").insert({
      company_id: companyId,
      conversation_id: conversationId,
      lead_id: leadId,
      event_type,
      payload: payload as never,
    });
  } catch (e) {
    console.error("[AI_AGENT_LOG_FAIL]", e);
  }
}

// ----------------------------------------------------------------------------
// Decision guards (puras)
// ----------------------------------------------------------------------------

/**
 * Horário comercial no fuso da empresa (`company_settings.ai_followup_timezone`).
 * O Worker roda em UTC: nunca usar `getHours()` direto. Suporta faixa que
 * atravessa a meia-noite (ex.: 18:00–02:00).
 */
export function isWithinBusinessHours(s: AgentSettings, now: Date = new Date()): boolean {
  const [sh, sm = 0] = s.business_hours_start.split(":").map(Number);
  const [eh, em = 0] = s.business_hours_end.split(":").map(Number);
  const local = zonedParts(now, safeTimeZone(s.ai_followup_timezone ?? null));
  const minsNow = local.hour * 60 + local.minute;
  const minsStart = sh * 60 + sm;
  const minsEnd = eh * 60 + em;
  if (minsStart <= minsEnd) return minsNow >= minsStart && minsNow < minsEnd;
  return minsNow >= minsStart || minsNow < minsEnd;
}

/** Janela móvel do limite `ai_max_auto_replies` (antes era vitalício por conversa). */
export const AUTO_REPLY_WINDOW_HOURS = 24;

/**
 * Guardas antes de qualquer chamada ao LLM.
 *
 * `recentAutoReplyCount` = respostas automáticas enviadas na conversa dentro de
 * `AUTO_REPLY_WINDOW_HOURS`. Mensagens rápidas do cliente não são mais
 * descartadas por tempo: a idempotência vem do lock + checagem de
 * "última mensagem do cliente ainda sem resposta" no tick.
 */
export function shouldAutoReply(
  conv: AgentConversation,
  settings: AgentSettings,
  now: Date = new Date(),
  recentAutoReplyCount: number = conv.auto_reply_count,
): { ok: true } | { ok: false; reason: SkipReason } {
  if (!settings.ai_auto_reply_enabled) return { ok: false, reason: "disabled" };
  if (conv.ai_status === "assumido_humano") return { ok: false, reason: "human_active" };
  if (conv.human_takeover_at) return { ok: false, reason: "human_active" };
  if (conv.ai_status === "aguardando_humano") return { ok: false, reason: "human_pending" };
  if (settings.ai_after_hours_only && isWithinBusinessHours(settings, now)) {
    return { ok: false, reason: "business_hours" };
  }
  if (recentAutoReplyCount >= settings.ai_max_auto_replies) {
    return { ok: false, reason: "rate_limit" };
  }
  return { ok: true };
}

/** true quando a última mensagem do cliente ainda não foi respondida. */
export function hasUnansweredLeadMessage(
  history: ReadonlyArray<{ role: "lead" | "agent" | "system" }>,
): boolean {
  const roles = history.map((item) => item.role);
  const lastLead = roles.lastIndexOf("lead");
  return lastLead >= 0 && lastLead > roles.lastIndexOf("agent");
}

// ----------------------------------------------------------------------------
// Handoff trigger detection (regex + heurística)
// ----------------------------------------------------------------------------

const PAYMENT_TERMS_PATTERN = /\bparcel/i;
const DELIVERY_TIME_PATTERN = /\bquand?o.*\b(instal|entreg|chega)/i;
const CHEAPER_PATTERN = /\bbarat/i;
const LOWEST_PRICE_PATTERN = /\bmenor preço\b/i;

const HANDOFF_PATTERNS: RegExp[] = [
  /\bdesconto\b/i,
  /\babatimento\b/i,
  /\bdescont/i,
  /\bnegoci/i,
  PAYMENT_TERMS_PATTERN,
  CHEAPER_PATTERN,
  LOWEST_PRICE_PATTERN,
  /\bfechar\b.*\b(hoje|agora|pedido)\b/i,
  /\bfinaliz/i,
  DELIVERY_TIME_PATTERN,
  /\bgaranti/i,
  /\breclama/i,
  /\bproblema\b/i,
  /\bquebr/i,
  /\bdefeit/i,
  /\bnota fiscal\b/i,
  /\bcontrato\b/i,
  /\bjurídic/i,
];

// Padrões de pergunta institucional: só vão para humano quando a empresa não
// cadastrou a política correspondente (ver sales-agent-institutional).
const INSTITUTIONAL_HANDOFF_PATTERNS = new Set<RegExp>([
  PAYMENT_TERMS_PATTERN,
  DELIVERY_TIME_PATTERN,
]);
// Palavras de preço ambíguas: podem ser comparação de preços cadastrados
// ("qual sai mais barato") ou negociação ("faz mais barato"). Quem distingue
// é o LLM; o turno fica marcado como sensível a preço (ver `priceSensitive`).
const PRICE_SENSITIVE_PATTERNS = new Set<RegExp>([CHEAPER_PATTERN, LOWEST_PRICE_PATTERN]);

export function detectHandoffNeeded(
  text: string,
  commercialRules?: AgentContext["grounding"]["commercialRules"] | null,
  options: { deferPriceSensitive?: boolean } = {},
): { needed: boolean; reason?: string; priceSensitive?: boolean } {
  const normalized = text.trim();
  const informationalQuestion =
    /^(?:voc[eê]s|qual|quais|quando|como|tem|posso|pode|quanto)\b.*\?$/i.test(normalized) ||
    /^se\s+eu\s+fechar\b/i.test(normalized);
  if (informationalQuestion) return { needed: false };
  const answeredByPolicy = resolveInstitutionalPolicies(text, commercialRules) !== null;
  let priceSensitive = false;
  for (const re of HANDOFF_PATTERNS) {
    if (answeredByPolicy && INSTITUTIONAL_HANDOFF_PATTERNS.has(re)) continue;
    if (!re.test(text)) continue;
    // Sem outro sinal de humano, adia a decisão para o LLM: no turno sensível
    // a preço, só a comparação determinística do catálogo pode responder;
    // qualquer outra saída continua indo para humano.
    if (options.deferPriceSensitive && PRICE_SENSITIVE_PATTERNS.has(re)) {
      priceSensitive = true;
      continue;
    }
    return { needed: true, reason: re.source };
  }
  return priceSensitive ? { needed: false, priceSensitive: true } : { needed: false };
}

// ----------------------------------------------------------------------------
// Safety layer pós-LLM (vence o LLM)
// ----------------------------------------------------------------------------

const SAFETY_BLOCK_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bdesconto\b/i, reason: "ofereceu desconto" },
  { pattern: /\bnegoci\w*/i, reason: "tentou negociar" },
  { pattern: /\bgaranto\b/i, reason: "fez promessa" },
  { pattern: /\bprometo\b/i, reason: "fez promessa" },
  { pattern: /\bfecho\b/i, reason: "tentou fechar venda" },
  { pattern: /\bcondição\s+especial\b/i, reason: "condição comercial nova" },
  { pattern: /\bparcelo\b/i, reason: "negociou parcelamento" },
];

const PERCENTAGE_PATTERN = /\b\d+(?:[.,]\d+)?\s?%/gi;

function canonicalPercentage(value: string): string {
  return value.replace(/\s+/g, "").replace(",", ".");
}

export function runSafetyLayer(
  decision: AgentDecision,
  commercialTerms?: string | null,
): AgentDecision {
  if (decision.kind !== "reply" || !decision.message) return decision;
  const registeredPercentages = new Set(
    (commercialTerms?.match(PERCENTAGE_PATTERN) ?? []).map(canonicalPercentage),
  );
  const unregisteredPercentage = (decision.message.match(PERCENTAGE_PATTERN) ?? []).some(
    (percentage) => !registeredPercentages.has(canonicalPercentage(percentage)),
  );
  if (unregisteredPercentage) {
    return {
      kind: "handoff",
      reason: "safety_block: tentou aplicar percentual/desconto",
      grounding_sources: decision.grounding_sources,
    };
  }
  for (const { pattern, reason } of SAFETY_BLOCK_PATTERNS) {
    if (pattern.test(decision.message)) {
      return {
        kind: "handoff",
        reason: `safety_block: ${reason}`,
        grounding_sources: decision.grounding_sources,
      };
    }
  }
  return decision;
}

// ----------------------------------------------------------------------------
// Context loader
// ----------------------------------------------------------------------------

export async function loadAgentContext(
  companyId: string,
  history: AgentHistory = [],
  salesState: ConversationSalesState | null = null,
): Promise<AgentContextBase | null> {
  const [{ data: settings }, { data: company }, { data: aiProfile }, grounding] = await Promise.all(
    [
      supabaseAdmin.from("company_settings").select("*").eq("company_id", companyId).maybeSingle(),
      supabaseAdmin.from("companies").select("name").eq("id", companyId).maybeSingle(),
      supabaseAdmin.from("ai_profiles").select("*").eq("company_id", companyId).maybeSingle(),
      loadSalesAgentGrounding(companyId, history, salesState, { deferCatalogSearch: true }),
    ],
  );
  if (!settings) return null;
  return {
    settings: settings as AgentSettings,
    companyName: company?.name ?? "—",
    aiProfile: aiProfile
      ? {
          tone: (aiProfile as { tone?: string }).tone ?? "comercial",
          description: (aiProfile as { description?: string | null }).description ?? null,
          products: (aiProfile as { products?: string | null }).products ?? null,
          payment_methods:
            (aiProfile as { payment_methods?: string | null }).payment_methods ?? null,
          avg_lead_time: (aiProfile as { avg_lead_time?: string | null }).avg_lead_time ?? null,
          region: (aiProfile as { region?: string | null }).region ?? null,
          differentials: (aiProfile as { differentials?: string | null }).differentials ?? null,
          faq: Array.isArray((aiProfile as { faq?: unknown }).faq)
            ? ((aiProfile as { faq: Array<{ q?: string; a?: string }> }).faq ?? [])
            : [],
        }
      : null,
    products: grounding.catalog,
    catalogProductIds:
      grounding.catalog.map((product) => product.id),
    knowledge: grounding.faqKnowledge,
    grounding: {
      ...grounding,
      commercialRules: {
        ...grounding.commercialRules,
        paymentMethods:
          grounding.commercialRules.paymentPolicy
            ? null
            : (aiProfile as { payment_methods?: string | null } | null)?.payment_methods ?? null,
      },
    },
  };
}

// ----------------------------------------------------------------------------
// LLM gateway adapter (efeito externo mantido fora do SalesAgentCore)
// ----------------------------------------------------------------------------

/** Evento append-only que guarda o Customer Context por empresa + conversa. */
export const SALES_TURN_PLAN_EVENT = "sales_turn_plan";

/** Último Customer Context da conversa (tolerante a falha: sem memória, segue). */
async function loadCustomerContext(
  companyId: string,
  conversationId: string,
): Promise<CustomerContext | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("ai_flow_events")
      .select("payload")
      .eq("company_id", companyId)
      .eq("conversation_id", conversationId)
      .eq("event_type", SALES_TURN_PLAN_EVENT)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return customerContextFromEventPayload((data as { payload?: unknown }).payload);
  } catch {
    return null;
  }
}

async function saveCustomerContext(
  companyId: string,
  conversationId: string,
  decision: AgentDecision,
  previous: CustomerContext | null,
): Promise<void> {
  const plan = decision.sales_plan;
  if (!plan) return;
  const merged = mergeCustomerContext(previous, {
    stage: plan.stage,
    nextAction: plan.nextAction,
    context: plan.context,
    presentedProductIds:
      decision.kind === "reply" ? decision.presented_product_ids ?? decision.suggested_products ?? [] : [],
  });
  await logEvent(companyId, conversationId, null, SALES_TURN_PLAN_EVENT, {
    stage: plan.stage,
    next_action: plan.nextAction,
    adjustments: plan.adjustments,
    decision: decision.kind,
    after_reply: decision.after_reply ?? null,
    customer_context: merged,
  });
}

export async function runAgentTurn(params: {
  ctx: AgentContextBase;
  history: Array<{ role: "lead" | "agent" | "system"; text: string; productIds?: string[] }>;
  leadName: string | null;
  onExternalSalesAgentResult?: (result: ExternalSalesAgentResult) => void | Promise<void>;
  sessionCorrections?: NormativeCorrection[];
  /** Turno com palavra de preço ambígua: só a comparação determinística responde. */
  priceSensitive?: boolean;
  salesStateScope?: Pick<ConversationSalesStateScope, "scopeType" | "scopeId">;
  /** Prazo do tick (epoch ms). Cada etapa do turno usa só o que resta dele. */
  deadlineAt?: number;
  qualification?: {
    detected_pool_size: string | null;
    detected_interest: string | null;
    detected_intent: string | null;
    detected_budget: string | null;
  };
}): Promise<AgentDecision> {
  const resolved = resolveSalesAgentLlmConfig();
  if (!resolved.ok) return { kind: "handoff", reason: resolved.reason };
  const { endpoint, model, apiKey } = resolved.config;
  const validatedCatalog = await loadServerValidatedCatalog(params.ctx.settings.company_id);
  if (!validatedCatalog) return { kind: "handoff", reason: "catalog_query_error" };
  const safeContext = restrictContextToActiveTenantCatalog(params.ctx, validatedCatalog);
  const [approvedCoachLearnings, activeCoachRules] = await Promise.all([
    loadRelevantSalesAgentLearnings(params.ctx.settings.company_id, params.history),
    listActiveCoachRulesForGrounding(
      params.ctx.settings.company_id,
      12,
      supabaseAdmin,
    ).catch(() => {
      console.warn("[SALES_AGENT_COACH_RULES_LOAD_FAILED]", { source: "coach-rules" });
      return [];
    }),
  ]);
  const qualificationContext: ProductSelectionContext | undefined = params.qualification
    ? {
        detectedPoolSize: params.qualification.detected_pool_size,
        detectedInterest: params.qualification.detected_interest,
        detectedIntent: params.qualification.detected_intent,
        detectedBudget: params.qualification.detected_budget,
      }
    : undefined;
  const relevantCoachRules = selectRelevantSalesAgentCoachRules(
    activeCoachRules,
    params.history,
    qualificationContext,
  );
  const baseNormative = resolveSalesAgentNormativeContext({
    companyId: params.ctx.settings.company_id,
    context: {
      ...params.ctx,
      grounding: {
        ...params.ctx.grounding,
        approvedCoachLearnings,
        activeCoachRules: relevantCoachRules,
      },
    },
    sessionCorrections: params.sessionCorrections,
  });
  const stateScope = params.salesStateScope
    ? { ...params.salesStateScope, companyId: params.ctx.settings.company_id }
    : null;
  const previousCustomerContext = stateScope
    ? await loadCustomerContext(stateScope.companyId, stateScope.scopeId)
    : null;
  const loadedSalesState = stateScope ? await loadConversationSalesState(stateScope) : null;
  let memoryStatus: "found" | "missing" | "error" = loadedSalesState?.status ?? "missing";
  let previousSalesState: ConversationSalesState | null = null;
  if (loadedSalesState?.status === "found" && stateScope) {
    const validated = await revalidateConversationSalesState(stateScope, loadedSalesState.state);
    if (validated.status === "validated") previousSalesState = validated.state;
    else memoryStatus = "error";
  }
  if (memoryStatus === "error") {
    console.warn("[SALES_AGENT_STATE_LOAD_FAILED]", { source: "conversation_sales_state" });
    await logEvent(params.ctx.settings.company_id, stateScope?.scopeId ?? null, null, "ai_flow_step", {
      ...buildSalesAgentAuditPayload({
        companyId: params.ctx.settings.company_id,
        conversationId: stateScope?.scopeId ?? null,
        mode: resolveSalesAgentMode(params.ctx.settings) ?? "off",
        decision: "error",
        result: "memory_error",
        blocked: "memory_error",
        tools: ["conversation_sales_state"],
        latencyMs: 0,
        tokensAvailable: null,
      }),
    });
  }
  // Explicit pipeline: interpretation -> catalogSearch -> decision -> redaÃ§Ã£o.
  const contextualMemoryError = memoryStatus === "error" && isContextualSalesAgentTurn(params.history);
  const effectiveHistory = reconcileHistoricalProductIds(
    params.history,
    new Set(validatedCatalog.map((product) => product.id)),
    memoryStatus === "error",
  );
  const effectiveMemoryStatus = memoryStatus === "error"
    ? (contextualMemoryError ? "error" : "missing")
    : memoryStatus;
  const interpretation = interpretSalesAgentTurn(effectiveHistory);
  const lexicalCatalogSearch = resolveSalesAgentCatalogSearch(
    interpretation,
    safeContext,
    memoryStatus === "error" ? null : previousSalesState,
    {
      continuityEnabled: resolveSalesAgentMode(params.ctx.settings) !== null,
      structuredInterpretation: interpretation.structured,
    },
  );
  // Foco da conversa (produtos em discussão), resolvido no histórico e na
  // memória do tenant. A busca lê só a última mensagem; em continuação sem
  // referência forte ("quanto tá?"), o foco entra com seus fatos validados.
  const validatedById = new Map(validatedCatalog.map((product) => [product.id, product]));
  const focusProductIds = getConversationFocusProductIds(effectiveHistory, [
    ...(previousCustomerContext?.presentedProductIds ?? []),
    ...(memoryStatus === "error" ? [] : previousSalesState?.lastValidProductIds ?? []),
  ]).filter((id) => validatedById.has(id));
  const catalogSearch = withConversationFocus(
    lexicalCatalogSearch,
    focusProductIds.flatMap((id) => {
      const product = validatedById.get(id);
      return product ? [product] : [];
    }),
  );
  if (catalogSearch.status === "query_error") {
    await logEvent(params.ctx.settings.company_id, stateScope?.scopeId ?? null, null, "ai_flow_step", {
      ...buildSalesAgentAuditPayload({
        companyId: params.ctx.settings.company_id,
        conversationId: stateScope?.scopeId ?? null,
        mode: resolveSalesAgentMode(params.ctx.settings) ?? "off",
        decision: "error",
        result: "catalog_error",
        blocked: "catalog_error",
        tools: ["catalog_search"],
        latencyMs: 0,
        tokensAvailable: null,
      }),
    });
  }
  const relevantCatalog = catalogSearch.status === "matches" ? catalogSearch.products : [];
  const filteredSalesState = mergeConversationSalesState(previousSalesState, {
    attributes: interpretation.attributes,
    intent: interpretation.intent,
    candidateProductIds: relevantCatalog.map((product) => product.id),
    lastCatalogQuery: {
      status: catalogSearch.status,
      criteria: interpretation.attributes,
      referencedProductIds: interpretation.references.productIds,
      subject: interpretation.structured.subject,
      productReferenceKind: interpretation.structured.productReference.kind,
      confirmation: interpretation.structured.confirmation,
      confidence: interpretation.structured.confidence,
    },
  });
  const conversationSummary = buildCompactSalesContextSummary({
    interpretation: interpretation.structured,
    productIds: filteredSalesState.productIds,
    lastValidProductIds: filteredSalesState.lastValidProductIds,
    lastCatalogQueryStatus: filteredSalesState.lastCatalogQuery?.status,
  });
  if (stateScope && memoryStatus !== "error") await saveSalesStateSafely(stateScope, filteredSalesState);
  const relevantQuickReplies = await loadRelevantSalesAgentQuickReplies(
    safeContext.settings.company_id,
    effectiveHistory,
    qualificationContext,
    {
      paymentMethods: safeContext.grounding.commercialRules.paymentMethods,
      guarantees: null,
      coachRules: baseNormative.grounding.activeCoachRules,
      playbook: SALES_AGENT_PLAYBOOK,
      catalog: catalogSearch.status === "matches" ? catalogSearch.products : [],
    },
  );
  const normative = resolveSalesAgentNormativeContext({
    companyId: params.ctx.settings.company_id,
    context: {
      ...params.ctx,
      grounding: {
        ...params.ctx.grounding,
        approvedCoachLearnings: baseNormative.grounding.approvedCoachLearnings,
        activeCoachRules: baseNormative.grounding.activeCoachRules,
        quickReplies: relevantQuickReplies,
      },
    },
    sessionCorrections: baseNormative.sessionCorrections,
  });
  const contextualParams = {
    ...params,
    history: effectiveHistory,
    structuredInterpretation: interpretation.structured,
    conversationSummary,
    compactContextEnabled: resolveSalesAgentMode(params.ctx.settings) !== null,
    sessionCorrections: normative.sessionCorrections,
    ctx: {
      ...params.ctx,
      catalogProductIds: relevantCatalog.map((product) => product.id),
      catalogForValidation: relevantCatalog,
      products: relevantCatalog,
      grounding: {
        ...params.ctx.grounding,
        catalogSearch,
        catalog: relevantCatalog,
        approvedCoachLearnings: normative.grounding.approvedCoachLearnings,
        activeCoachRules: normative.grounding.activeCoachRules,
        quickReplies: normative.grounding.quickReplies,
      },
    },
  };

  const external = await callExternalSalesAgent({
    companyId: params.ctx.settings.company_id,
    conversationId: params.salesStateScope?.scopeId ?? null,
    history: params.history,
    leadName: params.leadName,
    context: params.ctx,
    budgetMs: externalSalesAgentBudgetMs(params.deadlineAt),
  });
  if (params.onExternalSalesAgentResult) {
    try { await params.onExternalSalesAgentResult(external); } catch { console.warn("[EXTERNAL_SALES_AGENT_AUDIT_FAILED]"); }
  }
  if (external.enabled && external.ok) return external.decision;
  // Assistido: se a Vendedora externa falha, o turno termina sem sugestão e o atendente
  // responde como já faria. O fallback para o agente interno podia transferir a conversa
  // para humano de verdade (aguardando_humano) numa falha que é só da integração.
  // Silent não altera nada e automatic precisa responder: ambos mantêm o fallback.
  if (external.enabled && !external.ok && resolveSalesAgentMode(params.ctx.settings) === "assisted") {
    return { kind: "skip", reason: "external_sales_agent_unavailable", fallback_reason: "external_sales_agent_unavailable" };
  }

  const core = new SalesAgentCore(async (payload) => {
    let res: Response;
    // Só o que resta do tick (menos a margem e o pós-decisão). Sem tempo útil, não chama o provedor:
    // a falha segue o caminho seguro existente (política cadastrada ou handoff).
    const timeoutMs = internalLlmTimeoutMs(params.deadlineAt);
    if (timeoutMs === null) return { ok: false, reason: "gateway_budget_exhausted" };
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      clearTimeout(t);
    } catch (e) {
      console.error("[AGENT_GATEWAY_NETWORK]", e);
      return { ok: false, reason: "gateway_network_fail" };
    }
    if (!res.ok) {
      const rawError = (await res.text().catch(() => "")).slice(0, 4_096);
      const diagnostic = parseGatewayErrorDiagnostic(rawError, apiKey);
      const requestId = sanitizeGatewayErrorValue(res.headers.get("x-request-id"), apiKey);
      console.error("[AGENT_GATEWAY_HTTP]", res.status, {
        ...diagnostic,
        ...(requestId ? { "x-request-id": requestId } : {}),
      });
      return { ok: false, reason: `gateway_http_${res.status}` };
    }
    return { ok: true, data: await res.json() };
  });

  const decision = await core.decide({
    ...contextualParams,
    model,
    catalogSearch,
    interpretation,
    memoryStatus: effectiveMemoryStatus,
    // Catálogo ativo completo da empresa para executar a comparação de preço
    // escolhida pelo LLM (o conjunto e os preços nunca vêm do modelo).
    priceComparison: {
      catalog: validatedCatalog,
      attributeMatches: filterProductsByStructuredAttributes(validatedCatalog, effectiveHistory),
    },
    customerContext: previousCustomerContext,
    focusProductIds,
  });
  // Customer Context: memória comercial da conversa, atualizada pelo plano
  // que o LLM escolheu e o gate validou.
  if (stateScope && decision.sales_plan) {
    await saveCustomerContext(stateScope.companyId, stateScope.scopeId, decision, previousCustomerContext);
  }
  if (stateScope && memoryStatus !== "error") {
    await saveSalesStateSafely(
      stateScope,
      mergeConversationSalesState(filteredSalesState, {
        intent: decision.detected_intent ?? interpretation.intent,
        candidateProductIds: relevantCatalog.map((product) => product.id),
        ...(decision.suggested_products?.length
          ? { selectedProductIds: decision.suggested_products }
          : {}),
      }),
    );
  }
  return redactSalesAgentDecision(decision);
}

// ----------------------------------------------------------------------------
// WhatsApp Cloud API sender (direto, sem alterar meta-send)
// ----------------------------------------------------------------------------

/**
 * Contrato de retorno discriminado de `sendWhatsappText`.
 *
 * - `simulated:false` → caminho legado / produção real (guard OFF ou tenant
 *   `production`). O externalId reflete o `wamid` retornado pela Meta.
 * - `simulated:true`  → EnvironmentGuard bloqueou (staging/unknown).
 *   Nenhuma requisição chegou à Graph API. Consumidores DEVEM tratar este
 *   caso como "ação não entregue" — sem retry, sem contagem como envio
 *   real, sem `external_id` fabricado.
 * - `ok:false`        → falha real (HTTP não-2xx ou erro de rede).
 */
export type SendWhatsappTextResult =
  | { ok: true; simulated: false; externalId: string | null }
  | {
      ok: true;
      simulated: true;
      externalId: null;
      simulationId: string | null;
      externalRequestSent: false;
    }
  | { ok: false; simulated: false; error: string };

export async function sendWhatsappText(params: {
  companyId: string;
  conversationId: string;
  leadId: string;
  text: string;
  productIds?: string[];
  /** Marcas adicionais gravadas em messages.source_metadata (ex.: esclarecimento). */
  metadata?: Record<string, string>;
}): Promise<SendWhatsappTextResult> {
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("phone, external_id, integration_id, channel")
    .eq("id", params.leadId)
    .eq("company_id", params.companyId)
    .maybeSingle();
  if (!lead) return { ok: false, simulated: false, error: "lead não encontrado" };

  const recipient = String(lead.external_id ?? lead.phone ?? "").replace(/\D/g, "");
  if (recipient.length < 8 || recipient.length > 15)
    return { ok: false, simulated: false, error: "telefone inválido" };

  const integrationQuery = supabaseAdmin
    .from("integrations")
    .select("id, access_token, external_account_id")
    .eq("company_id", params.companyId)
    .eq("channel", "whatsapp")
    .eq("active", true);
  const { data: integration } = lead.integration_id
    ? await integrationQuery.eq("id", lead.integration_id).maybeSingle()
    : await integrationQuery.limit(1).maybeSingle();

  // Nunca completa credenciais com o número global de outro tenant.
  const credentials = resolveWhatsappSendCredentials(integration);
  if (!credentials.ok)
    return { ok: false, simulated: false, error: "WhatsApp não conectado" };
  const { accessToken: accessTok, phoneNumberId } = credentials;

  const apiUrl = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: recipient,
    type: "text" as const,
    text: { body: params.text },
  };
  const outbound = await postGraph<{
    messages?: Array<{ id: string }>;
    error?: { message?: string };
  }>({
    companyId: params.companyId,
    action: "whatsapp.send.text",
    url: apiUrl,
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessTok}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    logicalPayload: payload,
    agentId: "ai-agent",
    extractExternalId: (j) =>
      (j as { messages?: Array<{ id: string }> })?.messages?.[0]?.id ?? null,
  });

  // Staging/unknown → simulação explícita. Consumidores DEVEM tratar como
  // não-entregue (sem retry, sem contagem real, sem external_id fabricado).
  if (isSimulation(outbound)) {
    return {
      ok: true,
      simulated: true,
      externalId: null,
      simulationId: outbound.simulationId,
      externalRequestSent: false,
    };
  }

  if (!isRealDelivery(outbound)) {
    if (outbound.externalRequestSent) {
      const providerErr = outbound.providerError as { message?: string } | null | undefined;
      const raw = outbound.rawBody ?? "";
      console.error("[AGENT_WHATSAPP_HTTP]", outbound.status, raw.slice(0, 500));
      return {
        ok: false,
        simulated: false,
        error: providerErr?.message ?? outbound.error,
      };
    }
    return { ok: false, simulated: false, error: `network: ${outbound.error}` };
  }

  const externalId = outbound.externalId;

  // Insere mensagem na DB (role=agent, source=ai_agent) — SOMENTE em envio real.
  await supabaseAdmin.from("messages").insert({
    company_id: params.companyId,
    conversation_id: params.conversationId,
    role: "agent",
    text: params.text,
    at: new Date().toISOString(),
    external_id: externalId,
    integration_id: integration?.id ?? null,
    source: "ai_agent",
    source_metadata: {
      ...(params.metadata ?? {}),
      // Todos os produtos apresentados (até o limite de opções exaustivas),
      // para "qual deles é mais barato?" comparar o conjunto inteiro.
      catalog_product_ids: (params.productIds ?? []).slice(0, MAX_SALES_AGENT_PRODUCT_IMAGES),
    },
  });
  await supabaseAdmin
    .from("conversations")
    .update({ last_message_at: new Date().toISOString(), awaiting_reply: false })
    .eq("id", params.conversationId)
    .eq("company_id", params.companyId);

  return { ok: true, simulated: false, externalId };
}

// ----------------------------------------------------------------------------
// Qualificação + persistência (Fase 2)
// ----------------------------------------------------------------------------

interface ConvQualifyRow {
  detected_city: string | null;
  detected_state: string | null;
  detected_pool_size: string | null;
  detected_intent: string | null;
  detected_interest: string | null;
  detected_budget: string | null;
  purchase_timing: string | null;
  customer_stage: string | null;
  lead_temperature: string | null;
  lead_score: number;
  lead_ready_to_close: boolean;
  detected_objections: string[] | null;
}

/**
 * Une o que o LLM extraiu nesse turno com o já armazenado, roda heurísticas
 * sobre a última mensagem do cliente, calcula score/temperatura e persiste
 * em conversations + opcionalmente bump em leads.status. Loga apenas o que
 * mudou no ai_flow_events (timeline).
 */
async function qualifyAndPersist(params: {
  companyId: string;
  conversationId: string;
  leadId: string;
  lastLeadText: string;
  current: ConvQualifyRow;
  decision: AgentDecision | null;
  /** false no modo `silent`: calcula e audita, mas não altera conversa/lead. */
  persist?: boolean;
}): Promise<{ temperature: Temperature; score: number; readyToClose: boolean }> {
  const { companyId, conversationId, leadId, lastLeadText, current, decision } = params;
  const persist = params.persist !== false;

  const detectedObjections: Objection[] = detectObjections(lastLeadText);
  const readyDetected = detectReadyToClose(lastLeadText);

  const mergedObjections = mergeObjections(current.detected_objections, detectedObjections);

  const next: Partial<ConvQualifyRow> = {
    detected_city: decision?.detected_city ?? current.detected_city,
    detected_state:
      (decision?.detected_state ? normalizeState(decision.detected_state) : null) ??
      current.detected_state ??
      normalizeState(lastLeadText) ??
      null,
    detected_pool_size: decision?.detected_pool_size ?? current.detected_pool_size,
    detected_intent: decision?.detected_intent ?? current.detected_intent,
    detected_interest: decision?.detected_interest ?? current.detected_interest,
    detected_budget: decision?.detected_budget ?? current.detected_budget,
    purchase_timing: decision?.purchase_timing ?? current.purchase_timing,
    customer_stage: decision?.customer_stage ?? current.customer_stage,
    detected_objections: mergedObjections,
    lead_ready_to_close: current.lead_ready_to_close || readyDetected,
  };

  const score = computeLeadScore({
    detected_city: next.detected_city,
    detected_state: next.detected_state,
    detected_pool_size: next.detected_pool_size,
    detected_interest: next.detected_interest,
    detected_budget: next.detected_budget,
    purchase_timing: (next.purchase_timing as PurchaseTiming | null) ?? null,
    customer_stage: (next.customer_stage as CustomerStage | null) ?? null,
    lead_ready_to_close: next.lead_ready_to_close,
    objections: mergedObjections,
  });
  const temperature = temperatureFromScore(score);
  next.lead_score = score;
  next.lead_temperature = temperature;

  if (!persist) {
    await logEvent(companyId, conversationId, leadId, "sales_agent_silent_qualification", {
      mode: "silent",
      score,
      temperature,
      ready_to_close: !!next.lead_ready_to_close,
      objections: mergedObjections,
    });
    return { temperature, score, readyToClose: !!next.lead_ready_to_close };
  }

  await supabaseAdmin
    .from("conversations")
    .update(next as never)
    .eq("id", conversationId)
    .eq("company_id", companyId);

  // Eventos de timeline — apenas diffs
  const diffs: Array<[string, unknown]> = [];
  if (next.detected_city && next.detected_city !== current.detected_city)
    diffs.push(["detected_city", next.detected_city]);
  if (next.detected_state && next.detected_state !== current.detected_state)
    diffs.push(["detected_state", next.detected_state]);
  if (next.detected_pool_size && next.detected_pool_size !== current.detected_pool_size)
    diffs.push(["detected_pool_size", next.detected_pool_size]);
  if (next.detected_intent && next.detected_intent !== current.detected_intent)
    diffs.push(["detected_intent", next.detected_intent]);
  if (next.detected_interest && next.detected_interest !== current.detected_interest)
    diffs.push(["detected_interest", next.detected_interest]);
  if (next.detected_budget && next.detected_budget !== current.detected_budget)
    diffs.push(["detected_budget", next.detected_budget]);
  if (next.purchase_timing && next.purchase_timing !== current.purchase_timing)
    diffs.push(["detected_timing", next.purchase_timing]);
  if (next.customer_stage && next.customer_stage !== current.customer_stage)
    diffs.push(["detected_stage", next.customer_stage]);
  for (const obj of detectedObjections) {
    if (!(current.detected_objections ?? []).includes(obj)) {
      diffs.push(["detected_objection", obj]);
    }
  }
  for (const [event, value] of diffs) {
    await logEvent(companyId, conversationId, leadId, event as string, { value });
  }
  if (temperature !== current.lead_temperature) {
    await logEvent(companyId, conversationId, leadId, "lead_temperature_changed", {
      from: current.lead_temperature,
      to: temperature,
      score,
    });
  }
  if (!current.lead_ready_to_close && next.lead_ready_to_close) {
    await logEvent(companyId, conversationId, leadId, "ready_to_close_detected", {
      score,
    });
  }

  // Bump status do lead automaticamente — sem regredir e sem mexer em fechado/perdido
  if (temperature === "quente") {
    const { data: leadRow } = await supabaseAdmin
      .from("leads")
      .select("status")
      .eq("id", leadId)
      .eq("company_id", companyId)
      .maybeSingle();
    const s = leadRow?.status as string | undefined;
    if (s === "novo" || s === "morno") {
      await supabaseAdmin
        .from("leads")
        .update({ status: "quente" as never })
        .eq("id", leadId)
        .eq("company_id", companyId);
      await logEvent(companyId, conversationId, leadId, "lead_bumped_to_hot", { from: s });
    }
  }

  return { temperature, score, readyToClose: !!next.lead_ready_to_close };
}

// ----------------------------------------------------------------------------
// Tick orquestrador: 1 turno completo
// ----------------------------------------------------------------------------

export type AgentTickResult = {
  ok: boolean;
  action: "replied" | "handoff" | "skipped" | "error" | "simulated";
  reason?: string;
};

/**
 * Marca, em `ai_suggestions_log`, a resposta que a Vendedora externa daria no modo
 * silent. Não é `v2_status:pending`: não entra na fila de aprovação do modo assistido.
 */
export const EXTERNAL_SILENT_CLASSIFICATION = "external_silent";

/** Reprocessamentos extras quando o cliente escreve enquanto o turno roda. */
export const MAX_AGENT_TICK_CATCHUP_RUNS = 2;
/**
 * Prazo total do tick. Rodando via waitUntil, o Worker tem ~30 s depois da
 * resposta; o lock precisa ser liberado antes disso.
 */
export const AGENT_TICK_BUDGET_MS = 40_000;
const AGENT_CATCHUP_MIN_BUDGET_MS = 10_000;

/**
 * Um turno completo + recuperação de mensagens rápidas.
 *
 * Mensagens do cliente que chegam enquanto o turno está em andamento não
 * disparam novo tick (trigger ignora conversa com lock e a rota responde
 * `lock_busy`). Por isso, depois de liberar o lock, verificamos se há
 * mensagem do cliente mais nova que o histórico lido; se houver, rodamos
 * de novo (limitado), sem a checagem de "já respondida" — a resposta
 * anterior foi gerada sem ver essa mensagem.
 */
export async function runAgentTick(
  conversationId: string,
  options: { budgetMs?: number } = {},
): Promise<AgentTickResult> {
  const deadlineAt = Date.now() + (options.budgetMs ?? AGENT_TICK_BUDGET_MS);
  let pass = await runAgentTickOnce(conversationId, { force: false, deadlineAt });
  for (let run = 0; run < MAX_AGENT_TICK_CATCHUP_RUNS; run += 1) {
    if (!pass.snapshot) break;
    // Sem orçamento para um turno inteiro, não pega o lock: o isolate seria
    // encerrado no meio e deixaria ai_handling=true.
    if (deadlineAt - Date.now() < AGENT_CATCHUP_MIN_BUDGET_MS) break;
    const newer = await hasLeadMessageAfter(pass.snapshot);
    if (!newer) break;
    const next = await runAgentTickOnce(conversationId, { force: true, deadlineAt });
    if (!next.snapshot && next.result.reason === "lock_busy") break;
    pass = next;
  }
  return pass.result;
}

type AgentTickSnapshot = { companyId: string; conversationId: string; lastMessageAt: string | null };

async function hasLeadMessageAfter(snapshot: AgentTickSnapshot): Promise<boolean> {
  try {
    let query = supabaseAdmin
      .from("messages")
      .select("id")
      .eq("company_id", snapshot.companyId)
      .eq("conversation_id", snapshot.conversationId)
      .eq("role", "lead");
    if (snapshot.lastMessageAt) query = query.gt("at", snapshot.lastMessageAt);
    const { data, error } = await query.limit(1);
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

type HistoryRow = {
  role: string;
  text: string;
  at: string;
  source_subtype?: string | null;
  source_metadata?: unknown;
};

/** Linha de `messages` → item de histórico do agente (produtos, esclarecimento, transcrição). */
function toAgentHistoryItem(row: HistoryRow): AgentHistory[number] & { clarification?: string } {
  const metadata =
    row.source_metadata && typeof row.source_metadata === "object" && !Array.isArray(row.source_metadata)
      ? (row.source_metadata as Record<string, unknown>)
      : {};
  const productIds = Array.isArray(metadata.catalog_product_ids)
    ? metadata.catalog_product_ids.filter((id): id is string => typeof id === "string")
    : typeof metadata.product_id === "string"
      ? [metadata.product_id]
      : [];
  const transcription =
    typeof metadata.transcription_text === "string" && metadata.transcription_text.trim()
      ? metadata.transcription_text.trim()
      : null;
  const text = transcription && isAudioPlaceholder(row.text) ? transcription : row.text;
  const clarification =
    typeof metadata.sales_agent_clarification === "string" ? metadata.sales_agent_clarification : null;
  return {
    role: row.role as "lead" | "agent" | "system",
    text,
    ...(productIds.length > 0 ? { productIds } : {}),
    ...(clarification ? { clarification } : {}),
  };
}

/** Espera máxima pela transcrição de áudio feita pelo webhook (após o INSERT). */
export const AUDIO_TRANSCRIPTION_WAIT_MS = 20_000;
export const AUDIO_TRANSCRIPTION_POLL_MS = 2_000;

function agentSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Texto neutro padrão (multissegmento, sem promessa de prazo). */
export const DEFAULT_HANDOFF_MESSAGE =
  "Vou passar sua conversa para um atendente da nossa equipe, que vai continuar seu atendimento por aqui.";

/**
 * Mensagem de transição por empresa (`company_settings.ai_handoff_message`):
 * ausente → padrão; texto vazio → desativada pela empresa.
 */
export function resolveHandoffMessage(settings: Pick<AgentSettings, "ai_handoff_message">): string | null {
  const configured = settings.ai_handoff_message;
  if (configured === undefined || configured === null) return DEFAULT_HANDOFF_MESSAGE;
  const trimmed = configured.trim();
  return trimmed ? trimmed.slice(0, 1000) : null;
}

/**
 * Avisa o cliente de que um atendente vai continuar. Só em modos que podem
 * enviar (legado/automatic); em silent/assisted o humano decide. Falha no
 * aviso nunca desfaz o handoff.
 */
async function sendHandoffNotice(
  conv: { id: string; company_id: string; lead_id: string },
  settings: AgentSettings,
  mode: SalesAgentMode | null,
): Promise<void> {
  if (!canSalesAgentSend(mode)) return;
  const text = resolveHandoffMessage(settings);
  if (!text) return;
  try {
    const sent = await sendWhatsappText({
      companyId: conv.company_id,
      conversationId: conv.id,
      leadId: conv.lead_id,
      text,
      metadata: { sales_agent_notice: "handoff" },
    });
    await logEvent(conv.company_id, conv.id, conv.lead_id, sent.ok ? "handoff_notice_sent" : "handoff_notice_failed", {
      simulated: sent.ok ? sent.simulated : false,
      ...(sent.ok ? {} : { error: sent.error }),
    });
  } catch {
    await logEvent(conv.company_id, conv.id, conv.lead_id, "handoff_notice_failed", {});
  }
}

/** Releitura do status: humano assumiu ou a conversa foi encaminhada a humano. */
async function humanTookOver(companyId: string, conversationId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from("conversations")
      .select("ai_status, human_takeover_at")
      .eq("id", conversationId)
      .eq("company_id", companyId)
      .maybeSingle();
    const row = data as { ai_status?: string | null; human_takeover_at?: string | null } | null;
    return (
      row?.ai_status === "assumido_humano" ||
      row?.ai_status === "aguardando_humano" ||
      Boolean(row?.human_takeover_at)
    );
  } catch {
    return false;
  }
}

/** Conta respostas automáticas de texto na janela móvel (imagens não contam). */
async function countRecentAutoReplies(
  companyId: string,
  conversationId: string,
  fallback: number,
  now: Date = new Date(),
): Promise<number> {
  try {
    const since = new Date(now.getTime() - AUTO_REPLY_WINDOW_HOURS * 3_600_000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("messages")
      .select("id, source_subtype")
      .eq("company_id", companyId)
      .eq("conversation_id", conversationId)
      .eq("role", "agent")
      .eq("source", "ai_agent")
      .gte("at", since)
      .limit(500);
    if (error || !Array.isArray(data)) return fallback;
    return data.filter((row) => !(row as { source_subtype?: string | null }).source_subtype).length;
  } catch {
    return fallback;
  }
}

async function runAgentTickOnce(
  conversationId: string,
  options: { force: boolean; deadlineAt: number },
): Promise<{ result: AgentTickResult; snapshot: AgentTickSnapshot | null }> {
  let snapshot: AgentTickSnapshot | null = null;
  const result = await runAgentTickPass(conversationId, options, (value) => {
    snapshot = value;
  });
  return { result, snapshot };
}

async function releaseAgentLock(conv: { id: string; company_id: string; lead_id: string }): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { error } = await supabaseAdmin
        .from("conversations")
        .update({ ai_handling: false })
        .eq("id", conv.id)
        .eq("company_id", conv.company_id);
      if (!error) return;
    } catch {
      // tenta de novo
    }
  }
  await logEvent(conv.company_id, conv.id, conv.lead_id, "ai_lock_release_failed", {});
}

async function runAgentTickPass(
  conversationId: string,
  options: { force: boolean; deadlineAt: number },
  recordSnapshot: (snapshot: AgentTickSnapshot) => void,
): Promise<AgentTickResult> {
  const { data: conv } = await supabaseAdmin
    .from("conversations")
    .select(
      "id, company_id, lead_id, channel, ai_handling, ai_status, auto_reply_count, last_auto_reply_at, human_takeover_at, detected_city, detected_state, detected_pool_size, detected_intent, detected_interest, detected_budget, purchase_timing, customer_stage, lead_temperature, lead_score, lead_ready_to_close, detected_objections",
    )
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return { ok: false, action: "error", reason: "conversation_not_found" };

  const currentQual: ConvQualifyRow = {
    detected_city: conv.detected_city ?? null,
    detected_state: (conv as { detected_state?: string | null }).detected_state ?? null,
    detected_pool_size: conv.detected_pool_size ?? null,
    detected_intent: conv.detected_intent ?? null,
    detected_interest: (conv as { detected_interest?: string | null }).detected_interest ?? null,
    detected_budget: (conv as { detected_budget?: string | null }).detected_budget ?? null,
    purchase_timing: (conv as { purchase_timing?: string | null }).purchase_timing ?? null,
    customer_stage: (conv as { customer_stage?: string | null }).customer_stage ?? null,
    lead_temperature: (conv as { lead_temperature?: string | null }).lead_temperature ?? null,
    lead_score: (conv as { lead_score?: number }).lead_score ?? 0,
    lead_ready_to_close: (conv as { lead_ready_to_close?: boolean }).lead_ready_to_close ?? false,
    detected_objections:
      (conv as { detected_objections?: string[] | null }).detected_objections ?? [],
  };

  // Atualmente Fase 1 suporta apenas WhatsApp para envio
  if (conv.channel !== "whatsapp") {
    return { ok: true, action: "skipped", reason: "channel_unsupported" };
  }

  const ctx = await loadAgentContext(conv.company_id);
  if (!ctx) return { ok: false, action: "error", reason: "no_settings" };

  const auditStartedAt = Date.now();
  const auditMode: SalesAgentAuditMode = resolveSalesAgentMode(ctx.settings) ?? "off";
  let auditFallbackReason: string | null = null;
  const writeSalesAgentAudit = async (
    decision: SalesAgentAuditDecision,
    result: string,
    productIds: readonly string[] = [],
    tools: readonly string[] = [],
    blocked: string | null = null,
  ) => {
    await logEvent(conv.company_id, conv.id, conv.lead_id, "ai_flow_step", {
      ...buildSalesAgentAuditPayload({
        companyId: conv.company_id,
        conversationId: conv.id,
        mode: auditMode,
        decision,
        productIds,
        tools,
        result,
        blocked,
        latencyMs: Date.now() - auditStartedAt,
        tokensAvailable: null,
        fallbackReason: auditFallbackReason,
      }),
    });
  };

  // Pré-flight: bloqueios de segurança antes de qualquer envio.
  if (!ctx.aiProfile) {
    await logEvent(conv.company_id, conv.id, conv.lead_id, "missing_ai_profile", {});
    return { ok: true, action: "skipped", reason: "missing_ai_profile" };
  }
  const { data: waInteg } = await supabaseAdmin
    .from("integrations")
    .select("id")
    .eq("company_id", conv.company_id)
    .eq("channel", "whatsapp")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (!waInteg) {
    await logEvent(conv.company_id, conv.id, conv.lead_id, "no_whatsapp_integration", {});
    return { ok: true, action: "skipped", reason: "no_whatsapp_integration" };
  }

  const recentAutoReplies = await countRecentAutoReplies(
    conv.company_id,
    conv.id,
    conv.auto_reply_count ?? 0,
  );
  const guard = shouldAutoReply(
    conv as AgentConversation,
    ctx.settings,
    new Date(),
    recentAutoReplies,
  );
  if (!guard.ok) {
    await logEvent(conv.company_id, conv.id, conv.lead_id, `skipped_${guard.reason}`, {});
    return { ok: true, action: "skipped", reason: guard.reason };
  }

  // `silent` só interpreta e audita: nunca envia nem altera conversa/lead.
  const v2Mode = resolveSalesAgentMode(ctx.settings);
  const silent = v2Mode === "silent";

  // Lock leve anti-corrida
  const { data: locked } = await supabaseAdmin
    .from("conversations")
    .update({ ai_handling: true })
    .eq("id", conv.id)
    .eq("company_id", conv.company_id)
    .eq("ai_handling", false)
    .select("id")
    .maybeSingle();
  if (!locked) {
    await logEvent(conv.company_id, conv.id, conv.lead_id, "skipped_human_active", {
      reason: "lock_busy",
    });
    return { ok: true, action: "skipped", reason: "lock_busy" };
  }

  // Passado o prazo, o turno é abandonado: o lock é liberado já e o que
  // ainda estiver rodando não envia nem altera a conversa.
  let abandoned = false;
  const abandonedResult: AgentTickResult = { ok: true, action: "skipped", reason: "turn_deadline" };
  const lockedTurn = (async (): Promise<AgentTickResult> => {
    // Histórico do DB (não confia no body)
    const readHistoryRows = async (): Promise<HistoryRow[]> => {
      const { data } = await supabaseAdmin
        .from("messages")
        .select("role, text, at, source_subtype, source_metadata")
        .eq("company_id", conv.company_id)
        .eq("conversation_id", conv.id)
        .order("at", { ascending: false })
        .limit(40);
      return (data ?? []) as HistoryRow[];
    };
    let msgs = await readHistoryRows();
    // Áudio recém-chegado ainda sem transcrição: espera (limitado) o webhook
    // concluir antes de interpretar, em vez de responder ao placeholder.
    const newestLead = msgs.find((m) => m.role === "lead");
    let audioState = newestLead ? classifyLeadAudio(newestLead) : "none";
    if (audioState === "pending") {
      const deadline = Date.now() + AUDIO_TRANSCRIPTION_WAIT_MS;
      while (audioState === "pending" && Date.now() < deadline) {
        await agentSleep(AUDIO_TRANSCRIPTION_POLL_MS);
        msgs = await readHistoryRows();
        const refreshed = msgs.find((m) => m.role === "lead");
        audioState = refreshed ? classifyLeadAudio(refreshed) : "none";
      }
    }
    recordSnapshot({
      companyId: conv.company_id,
      conversationId: conv.id,
      lastMessageAt: msgs[0]?.at ?? null,
    });
    const history = [...msgs].reverse().map(toAgentHistoryItem);

    const lastLeadMsg = [...history].reverse().find((m) => m.role === "lead");
    if (!lastLeadMsg) {
      return { ok: true, action: "skipped", reason: "no_lead_message" };
    }
    // Idempotência: gatilho duplicado/atrasado para mensagem já respondida
    // (pela IA ou por humano) não gera novo turno nem custo de LLM.
    if (!options.force && !hasUnansweredLeadMessage(history)) {
      return { ok: true, action: "skipped", reason: "already_answered" };
    }

    // Áudio sem transcrição (falhou ou não chegou a tempo): pede texto ao
    // cliente em vez de encaminhar a humano por falta de conteúdo.
    const audioUnavailable = audioState === "pending" || audioState === "failed";

    // Pre-check handoff — sempre qualifica antes para timeline ficar completa.
    // Perguntas de pagamento/entrega/instalação com política cadastrada seguem
    // para a IA responder pela política.
    // Palavra de preço ambígua ("barato", "menor preço") não encaminha direto:
    // o LLM distingue comparação de negociação e só a comparação
    // determinística do catálogo pode responder esse turno.
    const triggerCheck: { needed: boolean; reason?: string; priceSensitive?: boolean } =
      audioUnavailable
        ? { needed: false }
        : detectHandoffNeeded(lastLeadMsg.text, ctx.grounding.commercialRules, {
            deferPriceSensitive: true,
          });
    const readyToClose = !audioUnavailable && detectReadyToClose(lastLeadMsg.text);
    if (triggerCheck.needed || readyToClose) {
      await qualifyAndPersist({
        companyId: conv.company_id,
        conversationId: conv.id,
        leadId: conv.lead_id,
        lastLeadText: lastLeadMsg.text,
        current: currentQual,
        decision: null,
        persist: !silent,
      });
      if (silent) {
        await writeSalesAgentAudit("handoff", "pre_check", [], ["handoff", "mode_guard"], "v2_silent");
        return { ok: true, action: "skipped", reason: "v2_silent" };
      }
      await supabaseAdmin
        .from("conversations")
        .update({ ai_status: "aguardando_humano" })
        .eq("id", conv.id)
        .eq("company_id", conv.company_id);
      await logEvent(conv.company_id, conv.id, conv.lead_id, "handoff_human", {
        source: "pre_check",
        pattern: triggerCheck.reason ?? (readyToClose ? "ready_to_close" : undefined),
      });
      await writeSalesAgentAudit("handoff", "pre_check", [], ["handoff"], "pre_check");
      await sendHandoffNotice(conv, ctx.settings, v2Mode);
      return {
        ok: true,
        action: "handoff",
        reason: readyToClose && !triggerCheck.needed ? "ready_to_close" : "pre_check_pattern",
      };
    }

    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("name")
      .eq("id", conv.lead_id)
      .eq("company_id", conv.company_id)
      .maybeSingle();

    let decision: AgentDecision;
    if (audioUnavailable) {
      decision = {
        kind: "reply",
        message: AUDIO_UNAVAILABLE_REPLY,
        suggested_products: [],
        product_image_ids: [],
        grounding_sources: [],
        learning_ids_used: [],
        fallback_reason: audioState === "failed" ? "audio_transcription_failed" : "audio_transcription_pending",
      };
    } else {
      const turnCtx = await loadAgentContext(conv.company_id, history);
      if (!turnCtx) return { ok: false, action: "error", reason: "no_settings" };
      // Percentuais citados em qualquer política cadastrada (ex.: entrada)
      // podem ser repetidos; os demais continuam bloqueados.
      const rules = ctx.grounding.commercialRules;
      decision = runSafetyLayer(
        await runAgentTurn({
          priceSensitive: triggerCheck.priceSensitive === true,
          ctx: turnCtx,
          history,
          leadName: lead?.name ?? null,
          salesStateScope: { scopeType: "whatsapp_conversation", scopeId: conv.id },
          deadlineAt: options.deadlineAt,
          qualification: currentQual,
          onExternalSalesAgentResult: async (external) => {
            // Sucesso também audita: no silent o turno termina em external_silent
            // sem nenhum outro evento.
            await logEvent(conv.company_id, conv.id, conv.lead_id, "ai_flow_step", {
              audit_kind: "external_sales_agent",
              result: external.enabled ? (external.ok ? "external_ok" : "external_fallback") : "external_disabled",
              ...(external.enabled && external.ok
                ? { decision: external.decision.kind }
                : { reason: external.reason }),
              ...(external.enabled && external.timing
                ? { budget_ms: external.timing.budgetMs, duration_ms: external.timing.durationMs }
                : {}),
              ...(external.enabled && !external.ok && external.httpStatus
                ? { http_status: external.httpStatus } : {}),
              ...(external.enabled && !external.ok && external.invalidResponseCode
                ? { invalid_response_code: external.invalidResponseCode } : {}),
              correlation_id: external.correlationId,
            });
          },
        }),
        [
          rules.commercialTerms,
          rules.paymentPolicy,
          rules.paymentMethods,
          rules.installationPolicy,
          rules.shippingPolicy,
          rules.nextLoadForecast,
          rules.visitPolicy,
          rules.includedItemsPolicy,
        ].filter(Boolean).join(" "),
      );
    }
    auditFallbackReason = decision.fallback_reason ?? null;

    if (abandoned) return abandonedResult;

    // Qualifica SEMPRE (handoff ou reply) com base no que veio do LLM + heurística
    await qualifyAndPersist({
      companyId: conv.company_id,
      conversationId: conv.id,
      leadId: conv.lead_id,
      lastLeadText: lastLeadMsg.text,
      current: currentQual,
      decision,
      persist: !silent,
    });

    if (decision.external_silent) {
      // Silent: a resposta da Vendedora externa não é enviada. Fica no log de sugestões
      // (mesma tabela e RLS das sugestões da IA, visível em /ia) para avaliação humana;
      // o ai_flow_events continua só com códigos. Falha aqui nunca altera o turno.
      if (decision.kind === "reply" && decision.message) {
        try {
          const { error } = await supabaseAdmin.from("ai_suggestions_log").insert({
            company_id: conv.company_id,
            conversation_id: conv.id,
            lead_id: conv.lead_id,
            generated_text: decision.message,
            classification: EXTERNAL_SILENT_CLASSIFICATION,
            model: "vendedora-externa",
            was_sent: false,
            was_edited: false,
            sent_text: null,
          });
          if (error) console.warn("[EXTERNAL_SALES_AGENT_SILENT_LOG_FAILED]");
        } catch {
          console.warn("[EXTERNAL_SALES_AGENT_SILENT_LOG_FAILED]");
        }
      }
      return { ok: true, action: "skipped", reason: "external_silent" };
    }

    if (decision.kind === "handoff" && silent) {
      await writeSalesAgentAudit(
        "handoff",
        "mode_gate",
        decision.suggested_products ?? [],
        ["safety_layer", "mode_guard"],
        "v2_silent",
      );
      return { ok: true, action: "skipped", reason: "v2_silent" };
    }

    if (decision.kind === "handoff") {
      if (v2Mode) {
        const handoffContract = prepareSalesAgentAction({
          v2Enabled: true,
          mode: v2Mode,
          companyId: conv.company_id,
          kind: "request_human_handoff",
          reason: decision.reason ?? "unknown",
        });
        if (!handoffContract.ok) {
          await logEvent(conv.company_id, conv.id, conv.lead_id, "sales_agent_action_contract_failed", {
            action: "request_human_handoff",
            code: handoffContract.code,
          });
        }
      }
      await supabaseAdmin
        .from("conversations")
        .update({ ai_status: "aguardando_humano" })
        .eq("id", conv.id)
        .eq("company_id", conv.company_id);
      const reason = decision.reason ?? "unknown";
      let evType = "handoff_human";
      if (reason.startsWith("safety_block")) evType = "safety_handoff";
      else if (reason.startsWith("gateway_")) evType = "gateway_timeout";
      await logEvent(conv.company_id, conv.id, conv.lead_id, evType, {
        reason,
        grounding_sources: decision.grounding_sources ?? [],
        learning_ids_used: decision.learning_ids_used ?? [],
        ...(decision.validation_diagnostic ? { validation_diagnostic: decision.validation_diagnostic } : {}),
      });
      await writeSalesAgentAudit("handoff", evType, decision.suggested_products ?? [], ["safety_layer", "handoff"], reason);
      await sendHandoffNotice(conv, ctx.settings, v2Mode);
      return { ok: true, action: "handoff", reason };
    }

    if (decision.kind !== "reply" || !decision.message) {
      await writeSalesAgentAudit("skipped", "no_message", decision.suggested_products ?? [], ["safety_layer"], "no_message");
      return { ok: true, action: "skipped", reason: "no_message" };
    }


    if (v2Mode !== null) {
      const authorization = await authorizeSalesAgentReply({
        mode: v2Mode,
        companyId: conv.company_id,
        conversationId: conv.id,
        leadId: conv.lead_id,
        text: decision.message,
        productIds: decision.suggested_products,
        persistSuggestion: async (pending) => {
          const { error } = await supabaseAdmin.from("ai_suggestions_log").insert(pending);
          return error ? { ok: false as const } : { ok: true as const };
        },
        audit: async (details) => {
          await writeSalesAgentAudit(details.decision, details.result, details.productIds, details.tools, details.blocked);
        },
      });
      if (authorization.kind === "error") {
        return { ok: false, action: "error", reason: authorization.reason };
      }
      if (authorization.kind === "blocked") {
        await logEvent(conv.company_id, conv.id, conv.lead_id, "auto_reply_v2_gated", {
          mode: v2Mode,
          reason: authorization.reason,
          suggested_products: decision.suggested_products ?? [],
        });
        return { ok: true, action: "skipped", reason: authorization.reason };
      }
    }

    // O turno do LLM leva segundos: um humano pode ter assumido nesse meio tempo.
    if (abandoned) return abandonedResult;
    if (await humanTookOver(conv.company_id, conv.id)) {
      await logEvent(conv.company_id, conv.id, conv.lead_id, "skipped_human_active", {
        reason: "human_took_over_during_turn",
      });
      await writeSalesAgentAudit("skipped", "human_active", decision.suggested_products ?? [], ["mode_guard"], "human_active");
      return { ok: true, action: "skipped", reason: "human_active" };
    }

    const sent = await sendWhatsappText({
      companyId: conv.company_id,
      conversationId: conv.id,
      leadId: conv.lead_id,
      text: decision.message,
      // Só o que o cliente viu vira "apresentado" na conversa.
      productIds: decision.presented_product_ids ?? decision.suggested_products,
      metadata: decision.clarification
        ? { sales_agent_clarification: decision.clarification }
        : audioUnavailable
          ? { sales_agent_notice: "audio_unavailable" }
          : undefined,
    });

    if (!sent.ok) {
      await logEvent(conv.company_id, conv.id, conv.lead_id, "send_failed", {
        stage: "send",
        error: sent.error,
      });
      await writeSalesAgentAudit("error", "send_error", decision.suggested_products ?? [], ["action_contract", "whatsapp_text"], "send_failed");
      return { ok: false, action: "error", reason: sent.error };
    }

    // Fluxo simulado (staging/unknown): NÃO conta como auto_reply real.
    // Sem incremento de auto_reply_count, sem last_auto_reply_at, sem
    // atualização de ai_status. Registra evento distinto para observabilidade.
    if (sent.simulated) {
      await logEvent(conv.company_id, conv.id, conv.lead_id, "auto_reply_simulated", {
        message: decision.message.slice(0, 240),
        simulation_id: sent.simulationId,
        external_request_sent: false,
        suggested_products: decision.suggested_products ?? [],
        grounding_sources: decision.grounding_sources ?? [],
        learning_ids_used: decision.learning_ids_used ?? [],
      });
      await writeSalesAgentAudit("simulated", "environment_guard", decision.suggested_products ?? [], ["action_contract", "whatsapp_text"], "simulated");
      return { ok: true, action: "simulated", reason: "environment_guard" };
    }

    const productImageSelectionContext = {
      history,
      detectedPoolSize: decision.detected_pool_size ?? currentQual.detected_pool_size,
      detectedInterest: decision.detected_interest ?? currentQual.detected_interest,
    };
    const requestedProductImageIds = decision.product_image_ids ?? [];
    if (requestedProductImageIds.length > 0) {
      const imageContract = v2Mode
        ? prepareSalesAgentAction({
            v2Enabled: true,
            mode: v2Mode,
            companyId: conv.company_id,
            kind: "send_product_images",
            conversationId: conv.id,
            leadId: conv.lead_id,
            productIds: requestedProductImageIds,
          })
        : null;
      if (imageContract?.ok === false) {
        await logEvent(conv.company_id, conv.id, conv.lead_id, "sales_agent_action_contract_failed", {
          action: "send_product_images",
          code: imageContract.code,
        });
        await writeSalesAgentAudit("error", "tool_error", requestedProductImageIds, ["action_contract", "product_images"], imageContract.code);
      }
      if (imageContract?.ok !== false) {
        try {
        const media = await sendWhatsappProductImages({
          companyId: conv.company_id,
          conversationId: conv.id,
          leadId: conv.lead_id,
          productIds: requestedProductImageIds,
          selectionContext: productImageSelectionContext,
        });
        await logEvent(conv.company_id, conv.id, conv.lead_id, "product_images_processed", {
          requested: requestedProductImageIds.length,
          sent: media.sent,
          failed: media.failed,
        });
        } catch {
          await logEvent(conv.company_id, conv.id, conv.lead_id, "product_images_failed", {
            requested: requestedProductImageIds.length,
          });
        }
      }
    }

    // Atualiza counters + status IA (apenas envio real). Não sobrescreve
    // status de atendimento humano definido durante o envio das mídias.
    const humanNow = await humanTookOver(conv.company_id, conv.id);
    await supabaseAdmin
      .from("conversations")
      .update({
        ...(humanNow ? {} : { ai_status: "pre_atendido_ia" }),
        auto_reply_count: (conv.auto_reply_count ?? 0) + 1,
        last_auto_reply_at: new Date().toISOString(),
      })
      .eq("id", conv.id)
      .eq("company_id", conv.company_id);

    await logEvent(conv.company_id, conv.id, conv.lead_id, "auto_reply_sent", {
      message: decision.message.slice(0, 240),
      external_id: sent.externalId,
      suggested_products: decision.suggested_products ?? [],
      grounding_sources: decision.grounding_sources ?? [],
      learning_ids_used: decision.learning_ids_used ?? [],
      ...(decision.validation_diagnostic ? { validation_diagnostic: decision.validation_diagnostic } : {}),
      // Fatos de Produtos que a resposta afirmou (declarados e validados).
      ...(decision.fact_claims ? { fact_claims: decision.fact_claims.slice(0, 20) } : {}),
    });
    await writeSalesAgentAudit("reply", "sent", decision.suggested_products ?? [], ["catalog_search", "action_contract", "whatsapp_text"]);

    // Fechamento: a IA confirmou a escolha do cliente; o pedido é concluído
    // por um atendente (capacidade `closing: human` da empresa).
    if (decision.after_reply === "handoff_for_closing" && !humanNow) {
      await supabaseAdmin
        .from("conversations")
        .update({ ai_status: "aguardando_humano" })
        .eq("id", conv.id)
        .eq("company_id", conv.company_id);
      await logEvent(conv.company_id, conv.id, conv.lead_id, "handoff_human", {
        source: "sales_plan",
        reason: "ready_to_close",
      });
      await sendHandoffNotice(conv, ctx.settings, v2Mode);
      return { ok: true, action: "handoff", reason: "ready_to_close_after_reply" };
    }

    return { ok: true, action: "replied" };
  })();
  lockedTurn.catch(() => undefined);

  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"deadline">((resolve) => {
    deadlineTimer = setTimeout(() => resolve("deadline"), Math.max(0, options.deadlineAt - Date.now()));
  });
  try {
    const outcome = await Promise.race([lockedTurn, deadline]);
    if (outcome !== "deadline") return outcome;
    abandoned = true;
    await logEvent(conv.company_id, conv.id, conv.lead_id, "agent_turn_deadline", {});
    return { ok: false, action: "error", reason: "turn_deadline" };
  } finally {
    clearTimeout(deadlineTimer);
    await releaseAgentLock(conv);
  }
}
