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
import { resolveSalesAgentLlmConfig } from "./sales-agent-config.server";
import { sendWhatsappProductImages } from "./sales-agent-product-images.server";
import {
  canSalesAgentSend,
  resolveSalesAgentMode,
  salesAgentModeReason,
} from "./sales-agent-mode";
import { resolveSalesAgentNormativeContext } from "./sales-agent-normative-resolver";
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

const DEBOUNCE_MS = 30_000;

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

export function isWithinBusinessHours(s: AgentSettings, now: Date = new Date()): boolean {
  const [sh, sm] = s.business_hours_start.split(":").map(Number);
  const [eh, em] = s.business_hours_end.split(":").map(Number);
  const minsNow = now.getHours() * 60 + now.getMinutes();
  const minsStart = sh * 60 + sm;
  const minsEnd = eh * 60 + em;
  return minsNow >= minsStart && minsNow < minsEnd;
}

export function shouldAutoReply(
  conv: AgentConversation,
  settings: AgentSettings,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: SkipReason } {
  if (!settings.ai_auto_reply_enabled) return { ok: false, reason: "disabled" };
  if (conv.ai_status === "assumido_humano") return { ok: false, reason: "human_active" };
  if (conv.human_takeover_at) return { ok: false, reason: "human_active" };
  if (settings.ai_after_hours_only && isWithinBusinessHours(settings, now)) {
    return { ok: false, reason: "business_hours" };
  }
  if (conv.auto_reply_count >= settings.ai_max_auto_replies) {
    return { ok: false, reason: "rate_limit" };
  }
  if (conv.last_auto_reply_at) {
    const diff = now.getTime() - new Date(conv.last_auto_reply_at).getTime();
    if (diff < DEBOUNCE_MS) return { ok: false, reason: "rate_limit" };
  }
  return { ok: true };
}

// ----------------------------------------------------------------------------
// Handoff trigger detection (regex + heurística)
// ----------------------------------------------------------------------------

const HANDOFF_PATTERNS: RegExp[] = [
  /\bdesconto\b/i,
  /\babatimento\b/i,
  /\bdescont/i,
  /\bnegoci/i,
  /\bparcel/i,
  /\bbarat/i,
  /\bmenor preço\b/i,
  /\bfechar\b.*\b(hoje|agora|pedido)\b/i,
  /\bfinaliz/i,
  /\bquand?o.*\b(instal|entreg|chega)/i,
  /\bgaranti/i,
  /\breclama/i,
  /\bproblema\b/i,
  /\bquebr/i,
  /\bdefeit/i,
  /\bnota fiscal\b/i,
  /\bcontrato\b/i,
  /\bjurídic/i,
];

export function detectHandoffNeeded(text: string): { needed: boolean; reason?: string } {
  const normalized = text.trim();
  const informationalQuestion =
    /^(?:voc[eê]s|qual|quais|quando|como|tem|posso|pode|quanto)\b.*\?$/i.test(normalized) ||
    /^se\s+eu\s+fechar\b/i.test(normalized);
  if (informationalQuestion) return { needed: false };
  for (const re of HANDOFF_PATTERNS) {
    if (re.test(text)) return { needed: true, reason: re.source };
  }
  return { needed: false };
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

export async function runAgentTurn(params: {
  ctx: AgentContextBase;
  history: Array<{ role: "lead" | "agent" | "system"; text: string; productIds?: string[] }>;
  leadName: string | null;
  sessionCorrections?: NormativeCorrection[];
  salesStateScope?: Pick<ConversationSalesStateScope, "scopeType" | "scopeId">;
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
  const catalogSearch = resolveSalesAgentCatalogSearch(
    interpretation,
    safeContext,
    memoryStatus === "error" ? null : previousSalesState,
    {
      continuityEnabled: resolveSalesAgentMode(params.ctx.settings) !== null,
      structuredInterpretation: interpretation.structured,
    },
  );
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

  const core = new SalesAgentCore(async (payload) => {
    let res: Response;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20_000);
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
  });
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

  const accessTok =
    integration?.access_token ||
    process.env.WHATSAPP_ACCESS_TOKEN ||
    process.env.WHATSAPP_API_KEY ||
    "";
  const phoneNumberId =
    integration?.external_account_id || process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  if (!accessTok || !phoneNumberId)
    return { ok: false, simulated: false, error: "WhatsApp não conectado" };

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
      catalog_product_ids: (params.productIds ?? []).slice(0, 5),
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
}): Promise<{ temperature: Temperature; score: number; readyToClose: boolean }> {
  const { companyId, conversationId, leadId, lastLeadText, current, decision } = params;

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

  await supabaseAdmin
    .from("conversations")
    .update(next as never)
    .eq("id", conversationId);

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
      .maybeSingle();
    const s = leadRow?.status as string | undefined;
    if (s === "novo" || s === "morno") {
      await supabaseAdmin
        .from("leads")
        .update({ status: "quente" as never })
        .eq("id", leadId);
      await logEvent(companyId, conversationId, leadId, "lead_bumped_to_hot", { from: s });
    }
  }

  return { temperature, score, readyToClose: !!next.lead_ready_to_close };
}

// ----------------------------------------------------------------------------
// Tick orquestrador: 1 turno completo
// ----------------------------------------------------------------------------

export async function runAgentTick(conversationId: string): Promise<{
  ok: boolean;
  action: "replied" | "handoff" | "skipped" | "error" | "simulated";
  reason?: string;
}> {
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

  const guard = shouldAutoReply(conv as AgentConversation, ctx.settings);
  if (!guard.ok) {
    await logEvent(conv.company_id, conv.id, conv.lead_id, `skipped_${guard.reason}`, {});
    return { ok: true, action: "skipped", reason: guard.reason };
  }

  // Lock leve anti-corrida
  const { data: locked } = await supabaseAdmin
    .from("conversations")
    .update({ ai_handling: true })
    .eq("id", conv.id)
    .eq("ai_handling", false)
    .select("id")
    .maybeSingle();
  if (!locked) {
    await logEvent(conv.company_id, conv.id, conv.lead_id, "skipped_human_active", {
      reason: "lock_busy",
    });
    return { ok: true, action: "skipped", reason: "lock_busy" };
  }

  try {
    // Histórico do DB (não confia no body)
    const { data: msgs } = await supabaseAdmin
      .from("messages")
      .select("role, text, at, source_metadata")
      .eq("conversation_id", conv.id)
      .order("at", { ascending: false })
      .limit(40);
    const history = [...(msgs ?? [])].reverse().map((m) => {
      const metadata =
        m.source_metadata &&
        typeof m.source_metadata === "object" &&
        !Array.isArray(m.source_metadata)
          ? (m.source_metadata as Record<string, unknown>)
          : {};
      const productIds = Array.isArray(metadata.catalog_product_ids)
        ? metadata.catalog_product_ids.filter((id): id is string => typeof id === "string")
        : typeof metadata.product_id === "string"
          ? [metadata.product_id]
          : [];
      return {
        role: m.role as "lead" | "agent" | "system",
        text: m.text,
        ...(productIds.length > 0 ? { productIds } : {}),
      };
    });

    const lastLeadMsg = [...history].reverse().find((m) => m.role === "lead");
    if (!lastLeadMsg) {
      return { ok: true, action: "skipped", reason: "no_lead_message" };
    }

    // Pre-check handoff — sempre qualifica antes para timeline ficar completa
    const triggerCheck = detectHandoffNeeded(lastLeadMsg.text);
    const readyToClose = detectReadyToClose(lastLeadMsg.text);
    if (triggerCheck.needed || readyToClose) {
      await qualifyAndPersist({
        companyId: conv.company_id,
        conversationId: conv.id,
        leadId: conv.lead_id,
        lastLeadText: lastLeadMsg.text,
        current: currentQual,
        decision: null,
      });
      await supabaseAdmin
        .from("conversations")
        .update({ ai_status: "aguardando_humano" })
        .eq("id", conv.id);
      await logEvent(conv.company_id, conv.id, conv.lead_id, "handoff_human", {
        source: "pre_check",
        pattern: triggerCheck.reason ?? (readyToClose ? "ready_to_close" : undefined),
      });
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
      .maybeSingle();

    const turnCtx = await loadAgentContext(conv.company_id, history);
    if (!turnCtx) return { ok: false, action: "error", reason: "no_settings" };

    const decision = runSafetyLayer(
      await runAgentTurn({
        ctx: turnCtx,
        history,
        leadName: lead?.name ?? null,
        salesStateScope: { scopeType: "whatsapp_conversation", scopeId: conv.id },
        qualification: currentQual,
      }),
      ctx.grounding.commercialRules.commercialTerms,
    );

    // Qualifica SEMPRE (handoff ou reply) com base no que veio do LLM + heurística
    await qualifyAndPersist({
      companyId: conv.company_id,
      conversationId: conv.id,
      leadId: conv.lead_id,
      lastLeadText: lastLeadMsg.text,
      current: currentQual,
      decision,
    });

    const v2Mode = resolveSalesAgentMode(ctx.settings);

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
        .eq("id", conv.id);
      const reason = decision.reason ?? "unknown";
      let evType = "handoff_human";
      if (reason.startsWith("safety_block")) evType = "safety_handoff";
      else if (reason.startsWith("gateway_")) evType = "gateway_timeout";
      await logEvent(conv.company_id, conv.id, conv.lead_id, evType, {
        reason,
        grounding_sources: decision.grounding_sources ?? [],
        learning_ids_used: decision.learning_ids_used ?? [],
      });
      return { ok: true, action: "handoff", reason };
    }

    if (decision.kind !== "reply" || !decision.message) {
      return { ok: true, action: "skipped", reason: "no_message" };
    }


    if (v2Mode && !canSalesAgentSend(v2Mode)) {
      await logEvent(conv.company_id, conv.id, conv.lead_id, "auto_reply_v2_gated", {
        mode: v2Mode,
        reason: salesAgentModeReason(v2Mode),
        message: decision.message.slice(0, 240),
        suggested_products: decision.suggested_products ?? [],
        grounding_sources: decision.grounding_sources ?? [],
        learning_ids_used: decision.learning_ids_used ?? [],
      });
      return { ok: true, action: "skipped", reason: salesAgentModeReason(v2Mode) };
    }

    if (v2Mode) {
      const textContract = prepareSalesAgentAction({
        v2Enabled: true,
        mode: v2Mode,
        companyId: conv.company_id,
        kind: "send_text",
        conversationId: conv.id,
        leadId: conv.lead_id,
        text: decision.message,
        productIds: decision.suggested_products,
      });
      if (!textContract.ok) {
        await logEvent(conv.company_id, conv.id, conv.lead_id, "sales_agent_action_contract_failed", {
          action: "send_text",
          code: textContract.code,
        });
        return { ok: false, action: "error", reason: textContract.code };
      }
    }

    const sent = await sendWhatsappText({
      companyId: conv.company_id,
      conversationId: conv.id,
      leadId: conv.lead_id,
      text: decision.message,
      productIds: decision.suggested_products,
    });

    if (!sent.ok) {
      await logEvent(conv.company_id, conv.id, conv.lead_id, "send_failed", {
        stage: "send",
        error: sent.error,
      });
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

    // Atualiza counters + status IA (apenas envio real)
    await supabaseAdmin
      .from("conversations")
      .update({
        ai_status: "pre_atendido_ia",
        auto_reply_count: (conv.auto_reply_count ?? 0) + 1,
        last_auto_reply_at: new Date().toISOString(),
      })
      .eq("id", conv.id);

    await logEvent(conv.company_id, conv.id, conv.lead_id, "auto_reply_sent", {
      message: decision.message.slice(0, 240),
      external_id: sent.externalId,
      suggested_products: decision.suggested_products ?? [],
      grounding_sources: decision.grounding_sources ?? [],
      learning_ids_used: decision.learning_ids_used ?? [],
    });

    return { ok: true, action: "replied" };
  } finally {
    // Libera lock
    await supabaseAdmin.from("conversations").update({ ai_handling: false }).eq("id", conv.id);
  }
}
