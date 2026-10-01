import {
  normalizeState,
  normalizeTiming,
  type CustomerStage,
  type PurchaseTiming,
} from "./ai-qualifier.server";
import { SALES_AGENT_MAX_OPTIONS, SALES_AGENT_PLAYBOOK } from "./sales-agent-playbook";
import type { ActiveCoachRuleGrounding } from "./coach-rules/coach-rules.repository";
import type { QuickReplyGrounding } from "./quick-replies/quick-replies.repository";
import {
  getPresentedProductIds,
  resolveCatalogProductReference,
  resolveCatalogProductReferenceWithContext,
} from "./sales-agent-product-resolution";
import { MAX_SALES_AGENT_PRODUCT_IMAGES } from "./sales-agent-product-images";
import type { StructuredSalesAgentInterpretation } from "./sales-agent-interpretation";
import { getConversationFocusProductIds } from "./sales-agent-focus";
import { segmentClaimsByProduct } from "./sales-agent-claim-anchors";
import {
  extractNumericFacts,
  hasNumericFacts,
  numericFactsHoldFor,
  productFactText,
  splitClauses,
  validateMeasureFact,
  validatePriceFact,
} from "./sales-agent-fact-claims";
import {
  SALES_NEXT_ACTIONS,
  SALES_NEXT_ACTION_DESCRIPTIONS,
  SALES_STAGES,
  buildBusinessKnowledge,
  gateSalesTurnPlan,
  parseSalesTurnPlan,
  renderBusinessKnowledge,
  renderCustomerContext,
  renderSalesCompetence,
  type CustomerContext,
  type SalesTurnPlan,
} from "./sales-agent-intelligence";
import {
  buildPriceComparisonReply,
  resolvePriceComparisonPool,
  type PriceComparisonOrder,
} from "./sales-agent-price-comparison";
import {
  INSTITUTIONAL_TOPICS,
  resolvePoliciesForTopics,
  type InstitutionalPolicy,
  buildInstitutionalPolicyReply,
  replyNumbersAreGrounded,
  resolveInstitutionalPolicies,
} from "./sales-agent-institutional";

/** Texto neutro (multissegmento) quando o item pedido não foi achado no catálogo. */
export const NO_MATCH_CLARIFICATION =
  "Não encontrei esse item no nosso catálogo com essas informações. Pode me passar mais detalhes, como o nome ou o modelo, para eu verificar?";

/** Pergunta qual das opções reais do catálogo o cliente quer (nomes cadastrados). */
export function buildAmbiguityClarification(products: ReadonlyArray<{ name: string }>): string {
  const names = products.map((product) => product.name.trim()).filter(Boolean);
  const list = names.length > 1
    ? `${names.slice(0, -1).join(", ")} ou ${names[names.length - 1]}`
    : names[0] ?? "";
  return `Encontrei mais de uma opção que pode ser a que você procura: ${list}. Qual delas você quer?`;
}

/** A última mensagem da IA antes do cliente já foi um pedido de esclarecimento. */
export function previousAgentAskedClarification(
  history: ReadonlyArray<{ role: "lead" | "agent" | "system"; clarification?: string }>,
): boolean {
  const lastLead = history.map((item) => item.role).lastIndexOf("lead");
  for (let index = lastLead - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item.role === "lead") return false;
    if (item.role === "agent") return Boolean(item.clarification);
  }
  return false;
}

export type SalesAgentGroundingSource =
  | "catalog"
  | "faq_knowledge"
  | "commercial_rules"
  | "coach_learnings"
  | "coach_rules"
  | "quick_replies";

export interface AgentSettings {
  company_id: string;
  ai_auto_reply_enabled: boolean;
  ai_after_hours_only: boolean;
  ai_initial_message: string | null;
  ai_max_auto_replies: number;
  ai_handoff_timeout_minutes: number;
  ai_agent_name: string;
  business_hours_start: string;
  business_hours_end: string;
  /** Fuso IANA da empresa (company_settings); ausente/inválido → padrão do calendário. */
  ai_followup_timezone?: string | null;
  /** Aviso ao cliente no handoff; ausente → texto padrão neutro, vazio → desativado. */
  ai_handoff_message?: string | null;
  sales_agent_v2_enabled?: boolean;
  sales_agent_v2_mode?: string;
}

export interface SalesAgentGrounding {
  catalog: Array<{
    id: string;
    name: string;
    model?: string | null;
    sku?: string | null;
    category: string | null;
    description: string | null;
    lengthM?: number | null;
    widthM?: number | null;
    depthM?: number | null;
    capacityL?: number | null;
    shape?: string | null;
    specifications?: unknown;
    includedItems?: string[];
    variants?: unknown[];
    price: number | null;
    promoPrice: number | null;
    images: string[];
    notes: string | null;
  }>;
  faqKnowledge: Array<{ question: string; answer: string; type: string }>;
  commercialRules: {
    paymentMethods: string | null;
    commercialTerms: string | null;
    paymentPolicy: string | null;
    installationPolicy: string | null;
    nextLoadForecast?: string | null;
    visitPolicy: string | null;
    heatingPolicy: string | null;
    shippingPolicy: string | null;
    includedItemsPolicy: string | null;
  };
  approvedCoachLearnings: Array<{
    id: string;
    category: string;
    title: string;
    description: string;
    rule: string;
    productRef: string | null;
    positiveExample: string | null;
    negativeExample: string | null;
    priority: number;
    confidence: number;
    companyId?: string | null;
    domain?: string | null;
    intent?: string | null;
    conflictKey?: string | null;
    sourceTrainingMessageId?: string | null;
  }>;
  catalogSearch: SalesAgentCatalogSearch;
  catalogScope?: { companyId: string; activeOnly: true };
  activeCoachRules?: ActiveCoachRuleGrounding[];
  quickReplies?: QuickReplyGrounding[];
}

export interface AgentContext {
  settings: AgentSettings;
  companyName: string;
  /** IDs do catálogo completo; o catálogo enviado ao prompt pode ser reduzido. */
  catalogProductIds?: string[];
  aiProfile: {
    tone: string;
    description: string | null;
    products: string | null;
    payment_methods: string | null;
    avg_lead_time: string | null;
    region: string | null;
    differentials: string | null;
    faq: Array<{ q?: string; a?: string }>;
  } | null;
  products: Array<{
    id: string;
    name: string;
    model?: string | null;
    sku?: string | null;
    category: string | null;
    description: string | null;
    lengthM?: number | null;
    widthM?: number | null;
    depthM?: number | null;
    capacityL?: number | null;
    shape?: string | null;
    specifications?: unknown;
    includedItems?: string[];
    variants?: unknown[];
    price: number | null;
    promoPrice: number | null;
    images: string[];
    notes: string | null;
  }>;
  /** Catálogo completo usado para validar afirmações objetivas fora do prompt compacto. */
  catalogForValidation?: SalesAgentGrounding["catalog"];
  knowledge: Array<{ question: string; answer: string; type: string }>;
  grounding: SalesAgentGrounding;
}

export type SalesAgentGroundingBase = Omit<SalesAgentGrounding, "catalogSearch">;
export type AgentContextBase = Omit<AgentContext, "grounding"> & {
  grounding: SalesAgentGroundingBase;
};

export interface AgentDecision {
  kind: "reply" | "handoff" | "skip";
  message?: string;
  reason?: string;
  detected_city?: string | null;
  detected_state?: string | null;
  detected_pool_size?: string | null;
  detected_intent?: string | null;
  detected_interest?: string | null;
  detected_budget?: string | null;
  purchase_timing?: PurchaseTiming | null;
  customer_stage?: CustomerStage | null;
  suggested_products?: string[];
  product_image_ids?: string[];
  grounding_sources?: SalesAgentGroundingSource[];
  learning_ids_used?: string[];
  /** Código do fallback determinístico acionado neste turno (diagnóstico/auditoria). */
  fallback_reason?: string;
  /** Pergunta de esclarecimento enviada no lugar de handoff (registrada na mensagem). */
  clarification?: "ambiguous" | "no_match";
  /** Plano de vendas do turno (estágio, próxima ação, contexto), já validado pelo gate. */
  sales_plan?: SalesTurnPlan | null;
  /** Ação após enviar a resposta (ex.: atendente conclui o fechamento). */
  after_reply?: "handoff_for_closing" | null;
  /**
   * Produtos que o cliente realmente viu nesta resposta (sugeridos pelo LLM,
   * citados no texto ou listados por resposta determinística). É o que vira
   * "já apresentado" na conversa; `suggested_products` pode incluir o
   * conjunto de validação sem que o cliente tenha visto.
   */
  presented_product_ids?: string[];
  /** Quando a validação bloqueia/troca a resposta do LLM: texto rejeitado e fatos usados. */
  validation_diagnostic?: SalesAgentValidationDiagnostic;
}

export interface SalesAgentValidationDiagnostic {
  /** Qual verificação rejeitou: objective_claim | product_fact | price_claim. */
  check: string;
  rejected_reply: string;
  suggested_product_ids: string[];
  /** "reference" (referência forte), "text_match", "default" ou "focus". */
  catalog_basis: string;
  validated_products: Array<{ id: string; name: string; price: number | null; promo_price: number | null }>;
}

export type SalesAgentCatalogSearch =
  | { status: "query_error"; error?: unknown }
  | { status: "empty_catalog"; products: [] }
  | { status: "no_match"; products: [] }
  | { status: "ambiguous"; products: SalesAgentGrounding["catalog"] }
  /** `exhaustive`: todos os compatíveis por atributo/medida ou comparação de preço (sem corte em 3). */
  | {
      status: "matches";
      products: SalesAgentGrounding["catalog"];
      exhaustive?: boolean;
      /** Ausente = referência forte; "text_match"/"default" = base fraca; "focus" = inclui o foco da conversa. */
      basis?: "text_match" | "default" | "focus";
      /** Produtos em foco na conversa presentes no conjunto (vão marcados no prompt). */
      focusProductIds?: string[];
    };

export interface SalesAgentCoreInput {
  ctx: AgentContext;
  history: Array<{
    role: "lead" | "agent" | "system";
    text: string;
    productIds?: string[];
    /** Marca de esclarecimento que a IA já enviou nesta mensagem. */
    clarification?: string;
  }>;
  /** Turno respondido só com as políticas cadastradas (sem catálogo). */
  institutionalOnly?: boolean;
  /**
   * Palavra de preço ambígua no turno (pré-check): só a comparação
   * determinística (`compare_catalog_prices`) pode responder; texto livre ou
   * outra saída vai para humano, como antes.
   */
  priceSensitive?: boolean;
  /** Turno reaberto com os produtos já apresentados como contexto (evita recursão). */
  followUpContext?: boolean;
  /** Memória comercial da conversa (Customer Context) carregada do turno anterior. */
  customerContext?: CustomerContext | null;
  /** Produtos em foco na conversa (histórico + memória), já validados no catálogo do tenant. */
  focusProductIds?: string[];
  /** Catálogo ativo completo + compatíveis por medida, para executar a comparação. */
  priceComparison?: {
    catalog: SalesAgentGrounding["catalog"];
    attributeMatches?: SalesAgentGrounding["catalog"] | null;
  };
  leadName: string | null;
  model: string;
  catalogSearch: SalesAgentCatalogSearch;
  interpretation: {
    intent: "product_images" | "product_inquiry" | null;
    attributes: object;
    references: { lastLeadText: string; productIds: string[] };
  };
  memoryStatus?: "found" | "missing" | "error";
  sessionCorrections?: SalesAgentSessionCorrection[];
  structuredInterpretation?: StructuredSalesAgentInterpretation;
  conversationSummary?: string;
  compactContextEnabled?: boolean;
}

export interface SalesAgentSessionCorrection {
  question: string;
  correction: string;
  companyId?: string | null;
  domain?: string | null;
  intent?: string | null;
  conflictKey?: string | null;
}

export interface SalesAgentCompletionRequest {
  model: string;
  reasoning_effort?: "none";
  messages: Array<{ role: "system" | "user"; content: string }>;
  tools: Array<Record<string, unknown>>;
  tool_choice: "auto";
}

export interface SalesAgentCompletionResponse {
  choices?: Array<{
    message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> };
  }>;
}

export type SalesAgentCompletion = (
  request: SalesAgentCompletionRequest,
) => Promise<{ ok: true; data: SalesAgentCompletionResponse } | { ok: false; reason: string }>;

interface ToolReply {
  message: string;
  detected_city?: string;
  detected_state?: string;
  detected_pool_size?: string;
  detected_intent?: string;
  detected_interest?: string;
  detected_budget?: string;
  purchase_timing?: string;
  customer_stage?: string;
  suggest_products?: string[];
  send_product_images?: string[];
  learning_ids_used?: string[];
  /** Plano comercial do turno (estágio, próxima ação, contexto do cliente). */
  sales_plan?: unknown;
}

interface ToolHandoff {
  reason: string;
}

/** Tool em que o LLM sinaliza a intenção de comparar preços cadastrados. */
export const COMPARE_CATALOG_PRICES_TOOL = "compare_catalog_prices";

interface ToolComparePrices {
  order?: PriceComparisonOrder | string;
  product_ids?: unknown[];
  other_topics?: unknown[];
}

export function customerAskedForProductImages(history: SalesAgentCoreInput["history"]): boolean {
  const lastLeadMessage = [...history].reverse().find((message) => message.role === "lead")?.text;
  if (!lastLeadMessage) return false;
  return /\b(foto(?:s)?|imagen(?:s)?|imagem|ver\s+(?:os\s+)?modelos?|mostr\w*\s+(?:os\s+)?modelos?)\b/i.test(
    lastLeadMessage,
  );
}

export function customerAskedAboutProducts(history: SalesAgentCoreInput["history"]): boolean {
  const lastLeadMessage = [...history].reverse().find((message) => message.role === "lead")?.text;
  if (!lastLeadMessage) return false;
  return /\b(produto|catálogo|modelos?|sku|piscina|fibra|vinil|spa|banheira|aquecedor|acessório|comprimento|largura|profundidade|litros?|capacidade|formato|quadrad[ao]s?|retangular|ret[ao]s?|redond[ao]s?|oval|cor|variante|preço|valor|custa|\d{1,2}\s*(?:m|metros?))\b/i.test(
    lastLeadMessage,
  );
}

export function getRequestedProductLength(
  history: Array<{ role: "lead" | "agent" | "system"; text: string }>,
): number | null {
  const text = [...history].reverse().find((message) => message.role === "lead")?.text ?? "";
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const dimension = /(?:^|\D)(\d{1,2}(?:[.,]\d+)?)\s*[x×]\s*\d{1,2}(?:[.,]\d+)?/.exec(
    normalized,
  );
  const dimensionIsSpace =
    dimension && /\b(?:espaco|terreno|area|quintal|local)\b[^\d]{0,18}$/.test(normalized.slice(0, dimension.index));
  const explicit = /comprimento\s*(?:de)?\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:m|metros?)?\b/.exec(
    normalized,
  );
  const mentionsOtherDimension = /\b(?:largura|profundidade)\b/.test(normalized);
  const generic = mentionsOtherDimension
    ? null
    : /(?:^|\D)(\d{1,2}(?:[.,]\d+)?)\s*(?:m|metros?)\b/.exec(normalized);
  const raw = dimensionIsSpace ? explicit?.[1] : dimension?.[1] ?? explicit?.[1] ?? generic?.[1];
  if (!raw) return null;
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function getAutomaticProductImageIds(
  history: Array<{ role: "lead" | "agent" | "system"; text: string }>,
  catalog: SalesAgentGrounding["catalog"],
): string[] {
  const requestedLength = getRequestedProductLength(history);
  if (requestedLength == null) return [];
  return catalog
    .filter(
      (product) =>
        product.lengthM === requestedLength &&
        product.images.some((image) => typeof image === "string" && image.trim().length > 0),
    )
    .map((product) => product.id)
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .slice(0, MAX_SALES_AGENT_PRODUCT_IMAGES);
}

function messageClaimsSpecificModel(message: string): boolean {
  const genericModelReference =
    /\b(?:do|da|de|um|uma|o|a|pelo|pela|nosso|nossa|seu|sua)\s+modelo\b(?!\s+[\p{L}\d])|\bmodelo\s+(?:e|ou|para|de vocês|da empresa|do catálogo|em questão|mencionado|espec[ií]fico|ideal|adequado|dispon[ií]vel|informado|escolhido)\b/iu.test(
      message,
    );
  return /\bmodelo\s+[\p{L}\d]/iu.test(message) && !genericModelReference;
}

function messageClaimsProductReference(message: string): boolean {
  return (
    messageClaimsSpecificModel(message) ||
    /\bproduto\s+[\p{L}\d]|\bpiscina\s+(?:de\s+)?(?:fibra|vinil|\d)/iu.test(message)
  );
}

function messagePromisesProductPresentation(message: string): boolean {
  return /\b(?:(?:vou|vamos|posso|podemos)\s+(?:te\s+|lhe\s+)?(?:mostrar|enviar|apresentar)|(?:te|lhe)\s+(?:mostro|envio|apresento))\b/i.test(
    message,
  );
}

function replyContinuesAffirmedOffer(
  message: string,
  history: SalesAgentCoreInput["history"],
): boolean {
  const conversationalHistory = history.filter((item) => item.role !== "system");
  const lastLeadIndex = conversationalHistory.map((item) => item.role).lastIndexOf("lead");
  if (lastLeadIndex < 1) return true;

  const lastLead = conversationalHistory[lastLeadIndex]?.text ?? "";
  const previousAgent = [...conversationalHistory.slice(0, lastLeadIndex)]
    .reverse()
    .find((item) => item.role === "agent")?.text ?? "";

  const normalize = (value: string) =>
    value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  const normalizedLead = normalize(lastLead);
  if (!/^(?:sim|pode|pode sim|claro|quero|quero sim|por favor|ok|okay|beleza)[!. ]*$/.test(normalizedLead)) {
    return true;
  }

  const normalizedOffer = normalize(previousAgent);
  const normalizedReply = normalize(message);
  const offeredIncludedItems = /\b(?:inclu[si]|inclus[oa]s?|acompanha|vem com)\b/.test(normalizedOffer);

  return !offeredIncludedItems ||
    /\b(?:inclu[si]|inclus[oa]s?|acompanha|vem com)\b/.test(normalizedReply);
}

function customerAskedForPrice(history: SalesAgentCoreInput["history"]): boolean {
  const lastLead = [...history].reverse().find((message) => message.role === "lead")?.text ?? "";
  return /\b(?:quanto\s+(?:custa|é)|qual\s+(?:é\s+)?o\s+(?:preço|valor)|preço|valor)\b/i.test(lastLead);
}

function customerAskedForMeasureDetails(history: SalesAgentCoreInput["history"]): boolean {
  const lastLead = [...history].reverse().find((message) => message.role === "lead")?.text ?? "";
  const normalized = lastLead
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(?:preco|valor|dimens(?:ao|oes)|litros?|capacidade|largura|profundidade|comprimento)\b/.test(
    normalized,
  );
}

function shouldUseBriefMeasureReply(
  history: SalesAgentCoreInput["history"],
  hasCatalogMatch: boolean,
): boolean {
  return (
    hasCatalogMatch &&
    getRequestedProductLength(history) !== null &&
    !customerAskedForPrice(history) &&
    !customerAskedForMeasureDetails(history)
  );
}

function buildBriefMeasureReply(): string {
  return "Temos sim. Vou te enviar os modelos dessa medida para você conhecer!";
}

function messageHasOnlyValidatedProductFacts(
  message: string,
  selectedProducts: SalesAgentGrounding["catalog"],
  catalog: SalesAgentGrounding["catalog"],
): boolean {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const normalized = normalize(message);
  const selectedIds = new Set(selectedProducts.map((product) => product.id));
  const mentionsIdentity = (product: SalesAgentGrounding["catalog"][number]) =>
    [product.name, product.model, product.sku]
      .filter((value): value is string => Boolean(value?.trim()))
      .some((value) => normalized.includes(normalize(value)));
  if (catalog.some((product) => mentionsIdentity(product) && !selectedIds.has(product.id))) {
    return false;
  }
  if (
    (/\bsku\b/.test(normalized) || messageClaimsSpecificModel(normalized)) &&
    !selectedProducts.some(mentionsIdentity)
  ) {
    return false;
  }
  // Medidas: cada valor é uma dimensão cadastrada do produto (campo
  // estruturado ou o mesmo fato escrito no próprio cadastro).
  const claimedMeasures = [...normalized.matchAll(/(\d{1,2}(?:[.,]\d+)?)\s*(?:m|metros?)\b/g)]
    .map((match) => Number(match[1].replace(",", ".")))
    .filter(Number.isFinite);
  if (
    !claimedMeasures.every((measure) =>
      selectedProducts.some((product) => validateMeasureFact(measure, product)),
    )
  ) {
    return false;
  }
  // Preços: o normal OU o promocional cadastrado (os dois podem aparecer).
  const claimedPrices = [...message.matchAll(/R\$\s*([\d.]+(?:,\d{1,2})?)/gi)]
    .map((match) => Number(match[1].replace(/\./g, "").replace(",", ".")))
    .filter(Number.isFinite);
  if (
    !claimedPrices.every((value) =>
      selectedProducts.some((product) => validatePriceFact({ value, promo: false }, product)),
    )
  ) {
    return false;
  }
  const claimedShape = ["retangular", "quadrad", "redond", "oval"].find((shape) =>
    normalized.includes(shape),
  );
  if (claimedShape) {
    const shapeMatches = selectedProducts.some((product) => {
      const shape = normalize(product.shape ?? "");
      return shape.includes(claimedShape);
    });
    if (!shapeMatches) return false;
  }
  return true;
}

export function buildValidatedCatalogReply(
  products: SalesAgentGrounding["catalog"],
  options: { rectangularPoolIntent?: boolean; includePrice?: boolean } = {},
): string {
  const items = products.map((product) => {
    const specificationFacts =
      product.specifications && typeof product.specifications === "object"
        ? Object.entries(product.specifications as Record<string, unknown>)
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join(", ")
        : "";
    const variantFacts = (product.variants ?? [])
      .flatMap((variant) => {
        if (!variant || typeof variant !== "object") return [];
        const row = variant as Record<string, unknown>;
        const values = [row.name, row.color].filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0,
        );
        return values.length > 0 ? [values.join("/")] : [];
      })
      .join(", ");
    const facts = [
      product.model ? `modelo ${product.model}` : null,
      product.sku ? `SKU ${product.sku}` : null,
      product.category ? `categoria ${product.category}` : null,
      options.includePrice
        ? `preço ${formatPrice(
            product.promoPrice != null &&
              Number.isFinite(product.promoPrice) &&
              product.promoPrice > 0
              ? product.promoPrice
              : product.price,
          )}`
        : null,
      product.lengthM != null || product.widthM != null || product.depthM != null
        ? `dimensões ${[product.lengthM, product.widthM, product.depthM]
            .filter((value) => value != null)
            .join(" x ")} m`
        : null,
      product.capacityL != null ? `capacidade ${product.capacityL} L` : null,
      product.shape ? `formato ${product.shape}` : null,
      product.description || null,
      product.includedItems?.length ? `itens inclusos: ${product.includedItems.join(", ")}` : null,
      specificationFacts ? `especificações: ${specificationFacts}` : null,
      variantFacts ? `variantes/cores: ${variantFacts}` : null,
      product.notes ? `observações: ${product.notes}` : null,
    ].filter((fact): fact is string => Boolean(fact));
    return `${product.name}${facts.length ? ` — ${facts.join("; ")}` : ""}.`;
  });
  const confirmation = options.rectangularPoolIntent
    ? "Entendi: você procura uma piscina com linhas retas, em formato retangular. "
    : "";
  return `${confirmation}Encontrei no catálogo: ${items.join(" ")}`;
}

export function hasRectangularPoolIntent(
  history: Array<{ role: "lead" | "agent" | "system"; text: string }>,
): boolean {
  const lastLead = [...history].reverse().find((message) => message.role === "lead")?.text ?? "";
  const normalized = lastLead
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(?:quadrad[ao]s?|ret[ao]s?)\b/.test(normalized);
}

function formatPrice(price: number | null): string {
  if (price == null) return "preço não cadastrado";
  const amount = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price);
  return `R$ ${amount}`;
}

export function getSalesAgentGroundingSources(ctx: AgentContext): SalesAgentGroundingSource[] {
  const sources: SalesAgentGroundingSource[] = [];
  if (ctx.grounding.catalog.length > 0 || ctx.products.length > 0) sources.push("catalog");
  if (ctx.grounding.faqKnowledge.length > 0 || ctx.knowledge.length > 0) {
    sources.push("faq_knowledge");
  }
  if (
    ctx.grounding.commercialRules.paymentMethods ||
    ctx.grounding.commercialRules.commercialTerms ||
    ctx.grounding.commercialRules.paymentPolicy ||
    ctx.grounding.commercialRules.installationPolicy ||
    ctx.grounding.commercialRules.nextLoadForecast ||
    ctx.grounding.commercialRules.visitPolicy ||
    ctx.grounding.commercialRules.heatingPolicy ||
    ctx.grounding.commercialRules.shippingPolicy ||
    ctx.grounding.commercialRules.includedItemsPolicy
  ) {
    sources.push("commercial_rules");
  }
  if (ctx.grounding.approvedCoachLearnings.length > 0) sources.push("coach_learnings");
  if ((ctx.grounding.activeCoachRules ?? []).length > 0) sources.push("coach_rules");
  if ((ctx.grounding.quickReplies ?? []).length > 0) sources.push("quick_replies");
  return sources;
}

function normalizePromptText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const FAQ_MAX_ITEMS = 6;
const FAQ_MAX_ITEM_CHARS = 400;
const PRODUCT_DESCRIPTION_MAX_CHARS = 240;
const PRODUCT_NOTES_MAX_CHARS = 200;
const PRODUCT_SPECIFICATIONS_MAX_CHARS = 300;
const HISTORY_MAX_CHARS = 6000;
const COACH_RULE_MAX_CHARS = 600;
const LEARNING_MAX_CHARS = 600;

function truncateProductText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1).trimEnd()}…`;
}

function comparablePromptText(value: string): string {
  return normalizePromptText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPromptSpecifications(
  value: unknown,
  product: SalesAgentGrounding["catalog"][number],
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const duplicateValues = new Set(
    [
      product.model,
      product.description,
      product.shape,
      product.capacityL == null ? null : String(product.capacityL),
      product.lengthM == null ? null : String(product.lengthM),
      product.widthM == null ? null : String(product.widthM),
      product.depthM == null ? null : String(product.depthM),
      product.lengthM == null || product.widthM == null
        ? null
        : `${product.lengthM} x ${product.widthM}${product.depthM == null ? "" : ` x ${product.depthM}`} m`,
    ]
      .filter((entry): entry is string => Boolean(entry))
      .map(comparablePromptText),
  );
  const technical = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) =>
      typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean",
    )
    .filter(([key, entry]) => {
      const keyText = comparablePromptText(key);
      const entryText = comparablePromptText(String(entry));
      if (/^internal(?: |_)|^private(?: |_)|metadata|sku|image|foto|count|total/.test(keyText)) {
        return false;
      }
      const isDuplicateDescription = /descricao|description/.test(keyText) && duplicateValues.has(entryText);
      const isDuplicateModel = /modelo|model/.test(keyText) && duplicateValues.has(entryText);
      const isDuplicateMeasure = /comprimento|largura|profundidade|dimens|tamanho|capacidade|volume|formato|shape/.test(
        keyText,
      ) && duplicateValues.has(entryText);
      return !isDuplicateDescription && !isDuplicateModel && !isDuplicateMeasure;
    })
    .map(([key, entry]) => `${key}: ${entry}`)
    .join("; ");
  return technical ? truncateProductText(technical, PRODUCT_SPECIFICATIONS_MAX_CHARS) : null;
}

function formatPromptVariants(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const variants = value
    .filter((entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
    )
    .map((entry) => [entry.name, entry.color]
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .join("/"))
    .filter(Boolean)
    .slice(0, 3);
  return variants.length > 0 ? variants.join(", ") : null;
}

function notesDuplicateIncludedItems(notes: string, includedItems: string[]): boolean {
  const ignored = new Set(["a", "as", "e", "o", "os", "itens", "inclui", "incluido", "incluidos", "incluso", "inclusos"]);
  const tokenize = (value: string) => comparablePromptText(value)
    .split(" ")
    .filter((token) => token && !ignored.has(token))
    .sort();
  const normalizedNotes = tokenize(notes);
  const normalizedItems = tokenize(includedItems.join(" "));
  if (normalizedNotes.length === 0 || normalizedItems.length === 0) return false;
  return normalizedNotes.join(" ") === normalizedItems.join(" ");
}

function parseCatalogNumber(value: string): number | null {
  const normalized = value.replace(/\s/g, "");
  const parsed = normalized.includes(",")
    ? Number(normalized.replace(/\./g, "").replace(",", "."))
    : Number(normalized.replace(/\.(?=\d{3}(?:\D|$))/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMoneyClaim(value: string, unit?: string): number | null {
  const amount = parseCatalogNumber(value);
  if (amount == null) return null;
  return unit?.toLowerCase() === "mil" || unit?.toLowerCase() === "k" ? amount * 1000 : amount;
}

function sameCatalogNumber(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.001;
}

const TECHNICAL_FIELD_SYNONYMS: Record<string, string[]> = {
  material: ["material", "composicao", "revestimento"],
  potencia: ["potencia"],
  voltagem: ["voltagem", "tensao"],
  acabamento: ["acabamento"],
  estrutura: ["estrutura"],
  filtragem: ["filtragem", "filtro"],
  bomba: ["bomba", "motobomba"],
  aquecimento: ["aquecimento"],
};

function hasMonetaryContext(
  message: string,
  history: SalesAgentCoreInput["history"],
): boolean {
  const monetaryPattern = /\b(pre[cç]o|valor|custa|custo|or[cç]amento|financeir|pagamento|pix|cart[aã]o|parcel|entrada|dinheiro)\b/i;
  const technicalPattern = /\b(capacidade|litros?|medid|comprimento|largura|profundidade|dimens|metros?|voltagem|tens[aã]o|pot[eê]ncia)\b/i;
  if (technicalPattern.test(message) && !monetaryPattern.test(message)) return false;
  if (monetaryPattern.test(message)) return true;

  const previous = history.filter((item) => item.role !== "system").at(-1)?.text ?? "";
  return monetaryPattern.test(previous) && !technicalPattern.test(previous);
}

function isNonFactualObjectiveMessage(message: string): boolean {
  const trimmed = message.trim();
  return /[?]\s*$/.test(trimmed) ||
    /^(?:qual|quais|seria|pode ser|posso|vou consultar|gostaria|quero saber)\b/i.test(trimmed);
}

function normalizedTechnicalTokens(value: string): string[] {
  return normalizePromptText(value)
    .replace(/,/g, ".")
    .replace(/(\d)\s+(?=[a-z])/g, "$1")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function technicalValueMatches(actual: string, expected: string): boolean {
  const actualTokens = normalizedTechnicalTokens(actual);
  const expectedTokens = normalizedTechnicalTokens(expected);
  for (let index = 0; index <= actualTokens.length - expectedTokens.length; index += 1) {
    if (expectedTokens.every((token, offset) => actualTokens[index + offset] === token)) return true;
  }
  return false;
}

function objectiveClaimSentences(message: string): string[] {
  return message
    .split(/[.!?;\n]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) =>
      /\b(pre[cç]o|valor|r\$|medid|comprimento|largura|profundidade|capacidade|litros?|modelo|formato|material|fibra|vinil|cor|acabamento|estrutura|filtro|bomba|pot[eê]ncia|voltagem|tens[aã]o|instala[cç][aã]o|inclus[oa]s?|aquecimento|aqueci|drenagem)\b/i.test(
        sentence,
      ),
    )
    .filter((sentence) =>
      !/^(?:vou|posso|podemos|qual|quais|como|gostaria|quero|vamos)\b/i.test(sentence),
    )
    .filter((sentence) =>
      !/\bmodelo\b/i.test(sentence) || messageClaimsSpecificModel(sentence),
    );
}

type PriceClaim = { value: number; promo: boolean; index: number };

/** Valores monetários afirmados na mensagem (R$, "custa", "fica", "5 mil"...). */
function extractPriceClaims(
  message: string,
  history: SalesAgentCoreInput["history"],
): PriceClaim[] {
  const priceClaims = [
    ...message.matchAll(/\b(pre[cç]o|valor|custa|fica)(?:\s+(promocional|promo[cç][aã]o|promo))?[^\d]{0,20}(?:r\$\s*)?([\d.]+(?:,\d{1,2})?)(?:\s*(mil|k))?/gi),
    ...[...message.matchAll(/r\$\s*([\d.]+(?:,\d{1,2})?)(?:\s*(mil|k))?/gi)].map((match) => {
      const normalized = [...match] as RegExpMatchArray;
      normalized[3] = normalized[1];
      normalized[4] = normalized[2];
      normalized.index = match.index;
      return normalized;
    }),
  ]
    .map((match) => ({
      value: parseMoneyClaim(match[3], match[4]),
      promo: /promo/i.test(
        `${match[2] ?? ""} ${message.slice(Math.max(0, (match.index ?? 0) - 30), match.index ?? 0)}`,
      ),
      index: match.index ?? 0,
    }))
    .filter((claim): claim is PriceClaim => claim.value != null)
    .filter((claim, index, claims) => claims.findIndex((item) => item.index === claim.index) === index);
  const standaloneMoney = message.trim().match(/^([\d.]+(?:,\d{1,2})?)(?:\s*(mil|k))?$/i);
  if (standaloneMoney && hasMonetaryContext(message, history)) {
    const value = parseMoneyClaim(standaloneMoney[1], standaloneMoney[2]);
    if (value != null) priceClaims.push({ value, promo: false, index: 0 });
  }
  return priceClaims;
}

// Valores inequivocamente monetários: "R$ 5.000", "5 mil", "5.000 reais" ou
// palavra de preço seguida de número que não é percentual, prazo ou medida.
const EXPLICIT_MONEY_PATTERN =
  /r\$\s*([\d.]+(?:,\d{1,2})?)(?:\s*(mil|k)\b)?|(?<![\d.,])([\d.]+(?:,\d{1,2})?)\s*(mil|k|reais)\b/gi;
const PRICE_WORD_MONEY_PATTERN =
  /\b(?:pre[cç]o|valor|custa|custam|sai\s+por|fica\s+por)\b[^\d%]{0,20}?([\d.]+(?:,\d{1,2})?)(?![\d.,]|\s*(?:%|x\b|vezes|parcelas?|dias?|meses|m[eê]s|horas?|h\b|anos?|m\b|metros?|cm|mm|l\b|litros?|mil\b|k\b|reais\b))/gi;

function monetaryClaimsIn(sentence: string): PriceClaim[] {
  const claims: PriceClaim[] = [];
  // O rótulo "promocional" vale só para o preço da MESMA oração, e só quando
  // ela tem um único preço ("R$ 12.900 promocional; normal R$ 15.900"). Uma
  // janela de caracteres atribuía o rótulo ao preço normal vizinho.
  let offset = 0;
  for (const clause of splitClauses(sentence)) {
    const clauseClaims: PriceClaim[] = [];
    for (const match of clause.matchAll(EXPLICIT_MONEY_PATTERN)) {
      const value = parseMoneyClaim(match[1] ?? match[3], match[2] ?? match[4]);
      if (value != null) clauseClaims.push({ value, promo: false, index: offset + (match.index ?? 0) });
    }
    for (const match of clause.matchAll(PRICE_WORD_MONEY_PATTERN)) {
      const value = parseMoneyClaim(match[1]);
      if (value != null) clauseClaims.push({ value, promo: false, index: offset + (match.index ?? 0) });
    }
    const distinctValues = new Set(clauseClaims.map((claim) => claim.value));
    const promo = distinctValues.size === 1 && /promo/i.test(clause);
    claims.push(...clauseClaims.map((claim) => ({ ...claim, promo })));
    offset += clause.length + 1;
  }
  return claims;
}

/**
 * Preços afirmados apenas em frases declarativas. Perguntas e intenções
 * ("Seria 20 mil?", "Vou consultar o valor de 20 mil.") não são fatos, nem
 * percentuais, prazos ou medidas ("entrada de 50%", "fica pronta em 15 dias").
 * Divide só em pontuação seguida de espaço para não quebrar "17.500,00".
 */
export function extractFactualPriceClaims(
  message: string,
  _history: SalesAgentCoreInput["history"] = [],
): PriceClaim[] {
  const seen = new Set<string>();
  return message
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && !isNonFactualObjectiveMessage(sentence))
    .flatMap(monetaryClaimsIn)
    .filter((claim) => {
      const key = `${claim.value}:${claim.promo}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Todo preço afirmado precisa ser o preço (normal ou promocional) de um produto do turno. */
export function factualPriceClaimsMatchProducts(
  claims: readonly PriceClaim[],
  products: SalesAgentGrounding["catalog"],
): boolean {
  return claims.every((claim) =>
    products.some((product) =>
      claim.promo
        ? product.promoPrice != null && sameCatalogNumber(product.promoPrice, claim.value)
        : [product.price, product.promoPrice].some(
            (price) => price != null && sameCatalogNumber(price, claim.value),
          ),
    ),
  );
}

function validateObjectiveProductClaims(
  message: string,
  products: SalesAgentGrounding["catalog"] | undefined,
  suggestedProductIds: string[],
  commercialRules: SalesAgentGrounding["commercialRules"],
  history: SalesAgentCoreInput["history"],
  /** Produto ao qual este trecho se refere (segmento ancorado). */
  anchor?: SalesAgentGrounding["catalog"][number],
): boolean {
  // Pergunta no fim da mensagem não isenta um preço afirmado antes dela
  // ("Fica R$ 5.000. Posso reservar?").
  if (
    isNonFactualObjectiveMessage(message) &&
    extractFactualPriceClaims(message, history).length === 0
  ) return true;
  // Fatos numéricos tipados (preço, dimensões, medida, capacidade), cada um
  // validado contra o seu campo — nunca a frase inteira contra o catálogo.
  const numericFacts = extractNumericFacts(message);
  const standaloneMoney = message.trim().match(/^([\d.]+(?:,\d{1,2})?)(?:\s*(mil|k))?$/i);
  if (standaloneMoney && hasMonetaryContext(message, history)) {
    const value = parseMoneyClaim(standaloneMoney[1], standaloneMoney[2]);
    if (value != null) numericFacts.prices.push({ value, promo: false });
  }
  // Afirmações qualitativas só nas orações que não carregam número já
  // validado por campo ("está saindo por R$ X", "medidas: 4 x 2,5 m").
  // (Remove só a oração numérica; o restante da MESMA frase continua junto,
  // preservando o sentido — "inclui instalação, filtro e bomba".)
  const qualitativeText = message
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((sentence) =>
      splitClauses(sentence)
        .filter((clause) => !hasNumericFacts(extractNumericFacts(clause)))
        .join(", "),
    )
    .filter(Boolean)
    .join(". ");
  const objectiveSentences = objectiveClaimSentences(qualitativeText);
  const hasObjectiveValue = hasNumericFacts(numericFacts) || objectiveSentences.length > 0;
  if (!hasObjectiveValue) return true;
  if (!products) return false;

  const normalizedMessage = comparablePromptText(message);
  const presentedIds = getPresentedProductIds(history);
  const presentedProducts = presentedIds.flatMap((id) => {
    const product = products.find((candidate) => candidate.id === id);
    return product ? [product] : [];
  });
  // A quem a resposta se refere: só pela identidade do produto no texto
  // (nome, modelo, apelido numérico). Referências posicionais ("a primeira",
  // "2") servem para mensagens do cliente; aplicadas à resposta, confundiam
  // dígitos de medidas/preços com referência a produto.
  const resolvedProduct = anchor
    ? { product: anchor, ambiguous: false }
    : resolveCatalogProductReference(message, products);
  if (resolvedProduct.ambiguous) {
    // Resposta sobre vários produtos: cada afirmação é validada contra o
    // produto cuja menção a inicia no texto. Sem âncora, não há validação
    // possível e o guardrail bloqueia.
    const segments = segmentClaimsByProduct(message, products);
    if (!segments || segments.length < 2) return false;
    return segments.every((segment) =>
      validateObjectiveProductClaims(
        segment.text,
        [segment.product],
        [segment.product.id],
        commercialRules,
        history,
        segment.product,
      ),
    );
  }
  const byMention = resolvedProduct.product
    ? [resolvedProduct.product]
    : products.filter((product) =>
    [product.name, product.model]
      .filter((value): value is string => Boolean(value))
      .some((value) => normalizedMessage.includes(comparablePromptText(value))),
      );
  // Sem produto nomeado, o escopo são os produtos do turno a que a resposta
  // se refere: sugeridos pelo LLM, senão os já apresentados, senão o
  // conjunto validado do turno. Fato que não vale para nenhum deles bloqueia.
  const named = byMention.length > 0;
  const suggestedScope = products.filter((product) => suggestedProductIds.includes(product.id));
  const candidates = named
    ? byMention
    : suggestedScope.length > 0
      ? suggestedScope
      : presentedProducts.length > 0
        ? presentedProducts
        : products;

  // Preço sem produto nomeado segue para a verificação de preço da decisão
  // (que responde com o catálogo validado); medidas/capacidade são
  // verificadas aqui contra o escopo do turno.
  const factsToCheck = named ? numericFacts : { ...numericFacts, prices: [] };
  if (!numericFactsHoldFor(factsToCheck, candidates)) return false;

  const semanticFacts = candidates.map((product) => ({
    model: comparablePromptText(`${product.name} ${product.model ?? ""}`),
    color: comparablePromptText(JSON.stringify(product.variants ?? [])),
    shape: comparablePromptText(product.shape ?? ""),
    basic: comparablePromptText(JSON.stringify({
      name: product.name,
      model: product.model,
      lengthM: product.lengthM,
      widthM: product.widthM,
      depthM: product.depthM,
      capacityL: product.capacityL,
      shape: product.shape,
    })),
    specifications: Object.entries(
      product.specifications && typeof product.specifications === "object" && !Array.isArray(product.specifications)
        ? product.specifications
        : {},
    ).map(([key, value]) => ({ key: comparablePromptText(key), value: comparablePromptText(String(value)) })),
    components: comparablePromptText(
      `${product.notes ?? ""} ${(product.includedItems ?? []).join(" ")}`,
    ),
    category: comparablePromptText(product.category ?? ""),
    // Todos os fatos do próprio cadastro (nome, categoria, descrição, notas,
    // especificações, itens, formato, variantes).
    general: comparablePromptText(
      [
        productFactText(product),
        product.category ?? "",
        product.shape ?? "",
        JSON.stringify(product.variants ?? []),
      ].join(" "),
    ),
  }));
  // Vocabulário de fatos do conjunto do turno: palavra que aparece em algum
  // produto é um fato de catálogo; palavra que não aparece em nenhum é
  // redação ("saindo", "externas") e não é comparada.
  const catalogVocabulary = new Set(
    products.flatMap((product) =>
      comparablePromptText(
        [productFactText(product), product.category ?? "", product.shape ?? "", JSON.stringify(product.variants ?? [])].join(" "),
      ).split(" "),
    ),
  );
  const policyFacts = comparablePromptText(
    [commercialRules.installationPolicy, commercialRules.includedItemsPolicy]
      .filter((value): value is string => Boolean(value))
      .join(" "),
  );
  return objectiveSentences.every((sentence) => {
    const normalizedSentence = comparablePromptText(sentence);
    const relevantFacts = /\binstalacao\b/.test(normalizedSentence)
      ? [
          comparablePromptText(commercialRules.installationPolicy ?? ""),
          comparablePromptText(commercialRules.includedItemsPolicy ?? ""),
          ...semanticFacts.map((facts) => facts.components),
        ].join(" ")
      : /\bmodelo\b/.test(normalizedSentence)
      ? semanticFacts.map((facts) => facts.model).join(" ")
      : /\bcor\b/.test(normalizedSentence)
        ? semanticFacts.map((facts) => facts.color).join(" ")
        : /\bformato\b/.test(normalizedSentence)
          ? semanticFacts.map((facts) => facts.shape).join(" ")
          : /\b(?:material|fibra|vinil)\b/.test(normalizedSentence)
            ? semanticFacts.flatMap((facts) => [facts.category, ...facts.specifications
              .filter((specification) => /material|composicao|revestimento|tipo/.test(specification.key))
              .map((specification) => `${specification.key} ${specification.value}`)]).join(" ")
            : /\b(?:filtro|bomba|inclus[oa]s?)\b/.test(normalizedSentence)
              ? [
                  comparablePromptText(commercialRules.includedItemsPolicy ?? ""),
                  ...semanticFacts.flatMap((facts) => [facts.components, ...facts.specifications
                .filter((specification) => /filtro|bomba|motobomba|inclus/.test(specification.key))
                .map((specification) => `${specification.key} ${specification.value}`)]),
                ].join(" ")
              : /\b(?:comprimento|largura|profundidade|capacidade|litros?)\b/.test(normalizedSentence)
                ? semanticFacts.map((facts) => `${facts.basic} ${facts.color}`).join(" ")
                : semanticFacts.flatMap((facts) => facts.specifications
                  .filter((specification) => Object.values(TECHNICAL_FIELD_SYNONYMS).some((aliases) =>
                    aliases.some((alias) => specification.key === alias && normalizedSentence.includes(alias)),
                  ))
                  .map((specification) => `${specification.key} ${specification.value}`)).join(" ");
    const claimTokens = normalizedSentence
      .split(" ")
      .filter((token) => token.length >= 4 && !new Set([
        "preco", "valor", "modelo", "produto", "piscina", "temos", "tem", "combina", "espaco", "profundidade",
        "capacidade", "litros", "comprimento", "largura", "medida",
        "voce", "descreveu", "disponivel", "com", "para", "uma", "esta", "esse", "essa", "que",
        "de", "do", "da", "e", "metros",
      ]).has(token));
    if (claimTokens.length === 0) return true;
    const technicalFieldClaim = Object.entries(TECHNICAL_FIELD_SYNONYMS).find(([, aliases]) =>
      aliases.some((alias) => normalizedSentence.includes(alias)),
    );
    const commercialInclusionClaim =
      /\b(?:instalacao|inclui|incluso|inclusa|inclusos|inclusas)\b/.test(normalizedSentence) &&
      !/\b(?:potencia|voltagem|tensao|capacidade|litros?|comprimento|largura|profundidade)\b/.test(
        normalizedSentence,
      ) &&
      !/\b\d+\s*(?:cv|hp|w|kw|v|volts?)\b/.test(normalizedSentence);
    if (technicalFieldClaim && !commercialInclusionClaim) {
      const matchingSpecifications = semanticFacts.flatMap((facts) => facts.specifications.filter((specification) =>
        technicalFieldClaim[1].includes(specification.key),
      ));
      if (matchingSpecifications.length === 0) return false;
      const claimValue = normalizedSentence
        .replace(new RegExp(`.*?(?:${technicalFieldClaim[1].join("|")})`, "i"), "")
        .trim();
      return matchingSpecifications.some((specification) => {
        return technicalValueMatches(claimValue, specification.value);
      });
    }
    if (!/\b(?:modelo|formato|material|fibra|vinil|cor|acabamento|estrutura|filtro|bomba|potencia|voltagem|tensao|instalacao|inclus[oa]s?|aquecimento|aqueci|drenagem)\b/i.test(normalizedSentence)) {
      return true;
    }
    const productFacts = new Set(
      [relevantFacts, policyFacts, ...semanticFacts.map((facts) => facts.general)]
        .join(" ")
        .split(" ")
        .filter(Boolean),
    );
    // Característica afirmada (presença de recurso/material/serviço) precisa
    // existir no cadastro do produto ou nas políticas cadastradas.
    const claimedFeatures = normalizedSentence.match(
      /\b(?:fibra|vinil|filtro|bomba|aquecimento|aqueci\w*|drenagem|instalacao|inclus[oa]s?)\b/g,
    ) ?? [];
    const featuresHold = claimedFeatures.every((feature) =>
      productFacts.has(feature) ||
      [...productFacts].some((fact) => fact.startsWith(feature.slice(0, 6))),
    );
    // Demais palavras: só as que são fato de catálogo precisam pertencer a
    // ESTE produto (fato de outro produto associado errado é bloqueado).
    // Atributo nomeado (cor, formato, material, acabamento, estrutura): o
    // valor afirmado tem de estar NO CAMPO desse atributo, não em outro.
    const identityTokens = new Set(
      candidates.flatMap((product) => comparablePromptText(`${product.name} ${product.model ?? ""}`).split(" ")),
    );
    const namesAttributeField = /\b(?:cor|formato|material|acabamento|estrutura)\b/.test(normalizedSentence);
    const fieldFacts = namesAttributeField
      ? new Set(relevantFacts.split(" ").filter(Boolean))
      : productFacts;
    const catalogFactTokens = claimTokens.filter(
      (token) => catalogVocabulary.has(token) && !identityTokens.has(token),
    );
    return featuresHold && catalogFactTokens.every((token) => fieldFacts.has(token));
  });
}

function faqTokens(value: string): Set<string> {
  const stopwords = new Set([
    "a", "ao", "as", "com", "da", "das", "de", "do", "dos", "e", "em", "o", "os",
    "para", "por", "que", "se", "um", "uma", "voce", "voces", "cliente", "piscina",
  ]);
  return new Set(
    normalizePromptText(value)
      .split(/\s+/)
      .map((token) => token.replace(/[^a-z0-9]/g, ""))
      .filter((token) => token.length >= 3 && !stopwords.has(token)),
  );
}

function truncateFaqItem(
  faq: SalesAgentGrounding["faqKnowledge"][number],
): SalesAgentGrounding["faqKnowledge"][number] {
  const prefix = `${faq.question} → `;
  if (prefix.length + faq.answer.length <= FAQ_MAX_ITEM_CHARS) return faq;
  const available = Math.max(0, FAQ_MAX_ITEM_CHARS - prefix.length - 1);
  return { ...faq, answer: `${faq.answer.slice(0, available).trimEnd()}…` };
}

function selectRelevantFaqs(
  faqKnowledge: SalesAgentGrounding["faqKnowledge"],
  profileFaq: Array<{ q?: string; a?: string }>,
  fallbackKnowledge: SalesAgentGrounding["faqKnowledge"],
  history: SalesAgentCoreInput["history"],
): SalesAgentGrounding["faqKnowledge"] {
  const conversation = history
    .slice(-8)
    .filter((message) => message.role === "lead")
    .map((message) => message.text)
    .join(" ");
  const conversationTokens = faqTokens(conversation);
  if (conversationTokens.size === 0) return [];

  const approved = faqKnowledge.length > 0 ? faqKnowledge : fallbackKnowledge;
  const candidates = [
    ...approved.map((faq) => ({ question: faq.question, answer: faq.answer, type: faq.type })),
    ...profileFaq
      .filter((faq): faq is { q: string; a: string } => Boolean(faq.q && faq.a))
      .map((faq) => ({ question: faq.q, answer: faq.a, type: "profile" })),
  ];
  const seenQuestions = new Set<string>();
  const seenContents = new Set<string>();
  return candidates
    .map((faq, index) => {
      const questionKey = normalizePromptText(faq.question).replace(/\s+/g, " ").trim();
      const contentKey = normalizePromptText(faq.answer).replace(/\s+/g, " ").trim();
      const overlap = [...faqTokens(`${faq.question} ${faq.answer}`)].filter((token) =>
        conversationTokens.has(token),
      ).length;
      return {
        faq,
        index,
        questionKey,
        contentKey,
        score: overlap,
        sourcePriority: index < approved.length ? 0 : 1,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => a.sourcePriority - b.sourcePriority || b.score - a.score || a.index - b.index)
    .filter((entry) => {
      if (seenQuestions.has(entry.questionKey) || seenContents.has(entry.contentKey)) return false;
      seenQuestions.add(entry.questionKey);
      seenContents.add(entry.contentKey);
      return true;
    })
    .slice(0, FAQ_MAX_ITEMS)
    .map(({ faq }) => truncateFaqItem(faq));
}

export function buildSalesAgentSystemPrompt(
  ctx: AgentContext,
  history: SalesAgentCoreInput["history"] = [],
  sessionCorrections: SalesAgentSessionCorrection[] = [],
  customerContext: CustomerContext | null = null,
): string {
  const ai = ctx.aiProfile;
  const catalogSearch = ctx.grounding.catalogSearch;
  const usesGroundedCatalog = catalogSearch.status === "matches";
  const groundedProducts = usesGroundedCatalog ? catalogSearch.products : [];
  const focusIds = new Set(usesGroundedCatalog ? catalogSearch.focusProductIds ?? [] : []);
  const relevantFaqs = selectRelevantFaqs(
    ctx.grounding.faqKnowledge,
    ai?.faq ?? [],
    ctx.knowledge,
    history,
  );
  const productLines = groundedProducts
    .map((p, i) => {
      const parts = [`${i + 1}. ${p.name} (ID: ${p.id})${focusIds.has(p.id) ? " [em foco na conversa]" : ""}`];
      if (p.model) parts.push(`   Modelo: ${p.model}`);
      if (p.sku) parts.push(`   SKU: ${p.sku}`);
      if (p.category) parts.push(`   Categoria: ${p.category}`);
      if (p.lengthM != null) parts.push(`   Comprimento: ${p.lengthM} m`);
      if (p.widthM != null) parts.push(`   Largura: ${p.widthM} m`);
      if (p.depthM != null) parts.push(`   Profundidade: ${p.depthM} m`);
      if (p.capacityL != null) parts.push(`   Capacidade: ${p.capacityL} L`);
      if (p.shape) parts.push(`   Formato real: ${p.shape}`);
      if (p.description) parts.push(`   ${p.description}`);
      if (usesGroundedCatalog) {
        parts.push(`   Preço cadastrado: ${formatPrice(p.price)}`);
        if (p.promoPrice != null) {
          parts.push(`   Preço promocional cadastrado: ${formatPrice(p.promoPrice)}`);
        }
      }
      if (p.notes) parts.push(`   Inclusos: ${p.notes}`);
      if (p.includedItems?.length) {
        parts.push(`   Itens inclusos: ${p.includedItems.join(", ")}`);
      }
      if (
        p.specifications &&
        typeof p.specifications === "object" &&
        Object.keys(p.specifications).length > 0
      ) {
        parts.push(`   Especificações: ${JSON.stringify(p.specifications)}`);
      }
      if (p.variants?.length) parts.push(`   Variantes/cores: ${JSON.stringify(p.variants)}`);
      if (p.images.length > 0) parts.push(`   Fotos cadastradas: ${p.images.length}`);
      return parts.join("\n");
    })
    .join("\n");
  const faqLines = relevantFaqs
    .map((k, i) => {
      const line = `${i + 1}. ${k.question} → ${k.answer}`;
      return line.length <= FAQ_MAX_ITEM_CHARS
        ? line
        : `${line.slice(0, FAQ_MAX_ITEM_CHARS - 1).trimEnd()}…`;
    })
    .join("\n");
  const kbLines = "";
  const commercialLines = [
    ctx.grounding.commercialRules.paymentPolicy
      ? `- Pagamento: ${ctx.grounding.commercialRules.paymentPolicy}`
      : ctx.grounding.commercialRules.paymentMethods
        ? `- Pagamento (cadastro legado): ${ctx.grounding.commercialRules.paymentMethods}`
        : null,
    ctx.grounding.commercialRules.installationPolicy
      ? `- Instalação: ${ctx.grounding.commercialRules.installationPolicy}`
      : null,
    ctx.grounding.commercialRules.nextLoadForecast
      ? `- Próxima carga prevista: ${ctx.grounding.commercialRules.nextLoadForecast}`
      : null,
    ctx.grounding.commercialRules.visitPolicy
      ? `- Visita: ${ctx.grounding.commercialRules.visitPolicy}`
      : null,
    ctx.grounding.commercialRules.heatingPolicy
      ? `- Aquecimento: ${ctx.grounding.commercialRules.heatingPolicy}`
      : null,
    ctx.grounding.commercialRules.shippingPolicy
      ? `- Frete: ${ctx.grounding.commercialRules.shippingPolicy}`
      : null,
    ctx.grounding.commercialRules.includedItemsPolicy
      ? `- Inclusos: ${ctx.grounding.commercialRules.includedItemsPolicy}`
      : null,
    ctx.grounding.commercialRules.commercialTerms
      ? `- Condições cadastradas: ${ctx.grounding.commercialRules.commercialTerms}`
      : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  const learningLines = ctx.grounding.approvedCoachLearnings
    .map((learning, i) => {
      return `${i + 1}. ${truncateProductText(`${learning.title}: ${learning.rule}`, LEARNING_MAX_CHARS)}`;
    })
    .join("\n");
  const coachRuleLines = (ctx.grounding.activeCoachRules ?? [])
    .map((rule, i) => `${i + 1}. ${truncateProductText(`${rule.title}: ${rule.content}`, COACH_RULE_MAX_CHARS)}`)
    .join("\n");
  const quickReplyLines = (ctx.grounding.quickReplies ?? [])
    .map((reply, i) => `${i + 1}. ${reply.name}: ${reply.content}`)
    .join("\n");
  const sessionCorrectionLines = sessionCorrections
    .map(
      (item, index) =>
        `${index + 1}. Pergunta: ${item.question}\n   Correção normativa desta sessão: ${item.correction}`,
    )
    .join("\n");
  const groundingSections = [
    commercialLines
      ? `POLÍTICAS OFICIAIS (prevalecem sobre Coach e FAQ; somente informe, nunca negocie nem crie condições; não use como fonte de fatos de produto):\n${commercialLines}`
      : null,
    learningLines
      ? `APRENDIZADOS ATIVOS DO COACH (somente orientação de comportamento comercial; nomes, modelos, medidas, preços, descrições, categorias e exemplos de produto contidos em aprendizados NÃO são fatos e devem ser ignorados):\n${learningLines}`
      : null,
    coachRuleLines
      ? `REGRAS ATIVAS APLICÁVEIS (fonte cadastrada; não substituem o playbook):\n${coachRuleLines}`
      : null,
    quickReplyLines
      ? `CONTEXTO OPERACIONAL DE RESPOSTAS RÃPIDAS (fonte cadastrada; nÃ£o Ã© regra comportamental):\n${quickReplyLines}`
      : null,
  ]
    .filter((section): section is string => Boolean(section))
    .join("\n\n");

  return `Você é "${ctx.settings.ai_agent_name}", vendedora consultiva da empresa "${ctx.companyName}" no atendimento por mensagem.
Você entende o cliente, responde o que ele pergunta e conduz a venda até o próximo passo, usando só o que a empresa cadastrou.

${renderSalesCompetence(customerContext?.stage ?? null)}

${SALES_AGENT_PLAYBOOK}

${renderBusinessKnowledge(buildBusinessKnowledge(ctx))}

${renderCustomerContext(customerContext)}

REGRAS INVIOLÁVEIS (se violar, peça handoff imediato):
- NUNCA invente nem negocie desconto, preço, parcelamento ou condição comercial. Você pode informar o preço exato cadastrado no produto; use o preço promocional válido quando existir, senão o preço normal.
- Perguntas sobre prazo de entrega/instalação devem ser respondidas pelas POLÍTICAS OFICIAIS cadastradas abaixo; só informe previsão quando perguntarem sobre prazo, entrega ou instalação, e nunca prometa uma data.
- NUNCA invente informação que não esteja no contexto abaixo.
- NUNCA conclua pedido nem crie condição: diante de sinal de compra, confirme a escolha (next_action confirm_purchase_intent) e um atendente finaliza.
- Para perguntas sobre prazo de entrega/instalação, só chame request_human_handoff se o cliente exigir uma data específica ou antecipada que dependa de confirmação humana.

${sessionCorrectionLines ? `CORREÇÕES NORMATIVAS APROVADAS DESTA SESSÃO (prevalecem sobre Coach rules e learnings conflitantes, somente como comportamento/instrução de atendimento):
${sessionCorrectionLines}
Use estas correções quando a pergunta atual for igual ou semanticamente semelhante. Elas não podem substituir fatos do CATÁLOGO nem POLÍTICAS OFICIAIS, não podem criar preço/condição comercial e não podem alterar IDs de produto.` : ""}

CONTEXTO DA EMPRESA:
- Tom: ${ai?.tone ?? "comercial"}
- Descrição: ${ai?.description ?? "—"}
- Região atendida: ${ai?.region ?? "—"}
- Diferenciais: ${ai?.differentials ?? "—"}
- Pagamento (apenas mencionar formas, sem negociar): ${ctx.grounding.commercialRules.paymentPolicy || ctx.grounding.commercialRules.paymentMethods ? "—" : ai?.payment_methods ?? "—"}

CATÁLOGO (use apenas estes produtos):${
    focusIds.size > 0
      ? "\nOs marcados [em foco na conversa] são os que o cliente acabou de ver; interprete pelo histórico a que produto(s) ele se refere e use só os fatos listados aqui."
      : ""
  }
${productLines || "(catálogo vazio)"}

REGRA DE REFERÊNCIA DE PRODUTO:
- Todo produto mencionado na resposta deve estar no CATÁLOGO acima e também ter seu ID incluído em suggest_products.
- Nunca use FAQ, histórico ou aprendizados como fonte de nome, modelo, medida, preço ou especificação de produto.
- Se o produto ou especificação pedida não estiver no catálogo, não proponha alternativa inventada: solicite atendimento humano.
- Descreva formato, medida e demais atributos exatamente como cadastrados; se o cliente usar outro termo para o mesmo atributo, confirme o entendimento sem renomear o dado do catálogo.

FAQ:
${faqLines || "(sem faq cadastrado)"}

BASE DE CONHECIMENTO APROVADA:
${kbLines || "(vazia)"}${groundingSections ? `\n\n${groundingSections}` : ""}

CONTRATO DE AÇÃO:
1. Em respond_to_customer, preencha sales_plan: o estágio da conversa, a próxima ação que você escolheu e o que aprendeu do cliente (necessidades, preferências, objeções, sinais de compra). Isso é memória para os próximos turnos, não texto ao cliente.
2. Se faltar dado cadastrado para responder ou a pergunta sair do escopo → request_human_handoff.
3. Preencha send_product_images quando o cliente pedir fotos/imagens/modelos OU quando sua resposta prometer mostrar, enviar ou apresentar produtos. Use somente IDs com fotos cadastradas, nunca invente IDs ou URLs e selecione no máximo 10 produtos.
4. Em pedidos por medida/atributo, os produtos do CATÁLOGO acima já são todos os compatíveis: apresente-os. Se o cliente apenas demonstrar interesse, responda em uma frase curta e natural, sem listar preços ou medidas não pedidos. Ausência de fotos ou de informação de disponibilidade não justifica handoff: não afirme disponibilidade e envie apenas fotos realmente cadastradas.
5. Quando o cliente quiser saber qual opção custa menos ou mais, use compare_catalog_prices (o sistema responde com os preços cadastrados); não escreva comparações de preço você mesmo. Pedido de desconto ou de valor diferente do cadastrado é negociação: request_human_handoff.

Sempre retorne via tool call (respond_to_customer, compare_catalog_prices OU request_human_handoff). Texto deve ser pt-BR, máx 4 frases, humano e sem clichês.`;
}

// Provedores OpenAI-compatible rejeitam `enum: []` (HTTP 400); sem valores, omite a restrição.
// A validação server-side em `decide` continua rejeitando IDs fora do catálogo/aprendizados.
function nonEmptyEnum(values: string[]): { enum?: string[] } {
  return values.length > 0 ? { enum: values } : {};
}

export function buildSalesAgentCompletionRequest(
  params: SalesAgentCoreInput,
): SalesAgentCompletionRequest {
  const catalogProducts = params.catalogSearch.status === "matches"
    ? params.catalogSearch.products
    : [];
  const transcriptEntries = params.history
    .slice(params.compactContextEnabled ? -8 : -20)
    .map(
      (m) =>
        `${m.role === "lead" ? "Cliente" : m.role === "agent" ? "Atendente" : "Sistema"}: ${m.text}`,
    );
  const transcript: string[] = [];
  let remainingHistoryChars = HISTORY_MAX_CHARS;
  for (let index = transcriptEntries.length - 1; index >= 0 && remainingHistoryChars > 0; index -= 1) {
    const entry = transcriptEntries[index];
    const selected = entry.length <= remainingHistoryChars
      ? entry
      : truncateProductText(entry, remainingHistoryChars);
    transcript.unshift(selected);
    remainingHistoryChars -= selected.length + (transcript.length > 1 ? 1 : 0);
  }

  return {
    model: params.model,
    ...(params.model.split("/").at(-1) === "gpt-5.6-luna"
      ? { reasoning_effort: "none" as const }
      : {}),
    messages: [
      {
        role: "system",
        content: buildSalesAgentSystemPrompt(
          params.ctx,
          params.history,
          params.sessionCorrections,
          params.customerContext ?? null,
        ),
      },
      {
        role: "user",
      content: (params.institutionalOnly
        ? "PERGUNTA INSTITUCIONAL: responda somente com o que está nas POLÍTICAS OFICIAIS cadastradas, sem citar produtos, valores ou prazos que não estejam nelas. Não negocie.\n\n"
        : "") + (params.compactContextEnabled
        ? `Estado compacto: ${params.conversationSummary ?? "none"}\n\nUltimas mensagens:\n${transcript.join("\n")}\n\nResponda seguindo as regras da sessao.`
        : `Lead: ${params.leadName ?? "—"}\n\nConversa até agora:\n${transcript.join("\n")}\n\nResponda seguindo as regras normativas da sessão quando forem relevantes.`),
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "respond_to_customer",
          description:
            "Enviar mensagem ao cliente. Sempre que possível extraia também os campos de qualificação observados na conversa (cidade, estado, medida desejada, tipo de cliente, etc.).",
          parameters: {
            type: "object",
            properties: {
              message: {
                type: "string",
                description: "Texto enviado ao cliente (pt-BR, máx 4 frases).",
              },
              detected_city: { type: "string", description: "Cidade do cliente/da entrega." },
              detected_state: { type: "string", description: "Estado/UF (ex.: SP, RJ)." },
              detected_pool_size: {
                type: "string",
                description: "Medida/tamanho desejado do produto, se o cliente informou.",
              },
              detected_intent: {
                type: "string",
                description: "Intenção principal (informação, orçamento, instalação, etc.).",
              },
              detected_interest: {
                type: "string",
                description: "Interesse específico (linha de produto, serviço ou categoria do catálogo).",
              },
              detected_budget: {
                type: "string",
                description: "Orçamento aproximado mencionado pelo cliente (ex.: 'até 20 mil').",
              },
              purchase_timing: {
                type: "string",
                enum: ["imediato", "30d", "60d", "90d+", "indefinido"],
                description: "Quando o cliente pretende comprar.",
              },
              customer_stage: {
                type: "string",
                enum: ["curioso", "pesquisando", "pronto_para_comprar"],
                description: "Em que estágio o cliente está.",
              },
              suggest_products: {
                type: "array",
                  items: {
                    type: "string",
                    ...nonEmptyEnum(catalogProducts.map((product) => product.id)),
                  },
                  description: "IDs exatos de produtos existentes no catálogo fornecido.",
              },
              send_product_images: {
                type: "array",
                items: { type: "string" },
                maxItems: 10,
                description:
                  "IDs de até 10 produtos do catálogo com fotos cadastradas. Use quando o cliente pedir imagens ou quando a resposta prometer mostrar, enviar ou apresentar produtos. Nunca envie URLs.",
              },
              learning_ids_used: {
                type: "array",
                items: {
                  type: "string",
                  ...nonEmptyEnum(
                    params.ctx.grounding.approvedCoachLearnings.map((learning) => learning.id),
                  ),
                },
                description:
                  "IDs dos aprendizados do Coach que influenciaram materialmente esta resposta. Não inclua aprendizados apenas por estarem no contexto.",
              },
              sales_plan: {
                type: "object",
                description:
                  "Seu raciocínio comercial deste turno (não é enviado ao cliente): estágio, próxima ação escolhida e o que você aprendeu do cliente.",
                properties: {
                  stage: { type: "string", enum: [...SALES_STAGES] },
                  next_action: {
                    type: "string",
                    enum: [...SALES_NEXT_ACTIONS],
                    description: SALES_NEXT_ACTIONS.map(
                      (action) => `${action}: ${SALES_NEXT_ACTION_DESCRIPTIONS[action]}`,
                    ).join("; "),
                  },
                  customer_context: {
                    type: "object",
                    properties: {
                      needs: { type: "array", items: { type: "string" } },
                      preferences: { type: "array", items: { type: "string" } },
                      objections: { type: "array", items: { type: "string" } },
                      buying_signals: { type: "array", items: { type: "string" } },
                    },
                    additionalProperties: false,
                  },
                },
                required: ["stage", "next_action"],
                additionalProperties: false,
              },
            },
            required: ["message"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: COMPARE_CATALOG_PRICES_TOOL,
          description:
            "Use quando o cliente quer saber qual opção custa menos ou custa mais (comparar os preços cadastrados), seja qual for a forma de dizer. O sistema monta a resposta só com preços reais do catálogo; não escreva preços. NÃO use para: pedido de desconto, abatimento, contraproposta, 'faz por X' ou pedir para baixar/melhorar o valor (isso é negociação: use request_human_handoff); nem para custo-benefício, qualidade ou 'qual vale mais a pena' (isso não é só preço: responda com respond_to_customer usando os fatos do catálogo).",
          parameters: {
            type: "object",
            properties: {
              order: {
                type: "string",
                enum: ["lowest_first", "highest_first"],
                description: "lowest_first = quer a opção que custa menos; highest_first = a que custa mais.",
              },
              product_ids: {
                type: "array",
                items: {
                  type: "string",
                  ...nonEmptyEnum(catalogProducts.map((product) => product.id)),
                },
                description:
                  "IDs exatos dos produtos que o cliente quer comparar, se ele citou ou restringiu opções. Vazio = opções já em discussão.",
              },
              other_topics: {
                type: "array",
                items: { type: "string", enum: [...INSTITUTIONAL_TOPICS] },
                description:
                  "Se a mesma mensagem também pergunta sobre pagamento (payment), instalação (installation), entrega/frete (delivery), visita (visit) ou itens inclusos (included), liste esses assuntos. O sistema responde com as políticas oficiais cadastradas. Vazio se não houver.",
              },
            },
            required: ["order"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "request_human_handoff",
          description: "Parar IA e marcar conversa para humano.",
          parameters: {
            type: "object",
            properties: { reason: { type: "string" } },
            required: ["reason"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: "auto",
  };
}

/**
 * Executa a comparação escolhida pelo LLM de forma determinística: conjunto e
 * preços vêm só do catálogo ativo da empresa; outros assuntos da mesma
 * mensagem são respondidos com as políticas cadastradas.
 */
function executePriceComparison(
  params: SalesAgentCoreInput,
  args: ToolComparePrices,
  helpers: {
    institutionalPolicies: InstitutionalPolicy[] | null;
    safeHandoff: (reason: string, fallbackReason?: string) => AgentDecision;
  },
): AgentDecision {
  const catalog =
    params.priceComparison?.catalog ??
    (params.catalogSearch.status === "matches" ? params.catalogSearch.products : []);
  const requestedProductIds = Array.isArray(args.product_ids)
    ? args.product_ids.filter((id): id is string => typeof id === "string")
    : [];
  const pool = resolvePriceComparisonPool({
    catalog,
    history: params.history,
    requestedProductIds,
    attributeMatches: params.priceComparison?.attributeMatches ?? null,
  });
  const comparison = buildPriceComparisonReply(pool, {
    order: args.order === "highest_first" ? "highest_first" : "lowest_first",
  });
  if (!comparison) return helpers.safeHandoff("catalog_price_unavailable");

  // Outros assuntos da mesma mensagem: tópicos do LLM + detecção
  // determinística existente; resposta sempre pelo texto da política.
  const requestedTopics = [
    ...(Array.isArray(args.other_topics)
      ? args.other_topics.filter((topic): topic is string => typeof topic === "string")
      : []),
    ...(helpers.institutionalPolicies ?? []).map((policy) => policy.topic),
  ];
  const policies = resolvePoliciesForTopics(requestedTopics, params.ctx.grounding.commercialRules);
  if (policies === null) {
    // Um dos assuntos pedidos não tem política cadastrada: não responder pela metade.
    return helpers.safeHandoff("secondary_topic_without_policy");
  }
  return {
    kind: "reply",
    message: [comparison.message, policies.length > 0 ? buildInstitutionalPolicyReply(policies) : null]
      .filter(Boolean)
      .join("\n"),
    suggested_products: comparison.productIds,
    product_image_ids: [],
    grounding_sources: policies.length > 0 ? ["catalog", "commercial_rules"] : ["catalog"],
    learning_ids_used: [],
    fallback_reason: "catalog_price_comparison",
  };
}

export class SalesAgentCore {
  constructor(private readonly complete: SalesAgentCompletion) {}

  async decide(params: SalesAgentCoreInput): Promise<AgentDecision> {
    const groundingSources = getSalesAgentGroundingSources(params.ctx);
    const availableLearningIds = params.ctx.grounding.approvedCoachLearnings.map(
      (learning) => learning.id,
    );
    const catalogSearch = params.catalogSearch;
    if (params.memoryStatus === "error") {
      return {
        kind: "handoff",
        reason: "conversation_sales_state_load_failed",
        grounding_sources: [],
        learning_ids_used: [],
      };
    }
    if (!catalogSearch) {
      return {
        kind: "handoff",
        reason: "catalog_query_error",
        grounding_sources: ["catalog"],
        learning_ids_used: [],
      };
    }
    const lastLeadText =
      [...params.history].reverse().find((message) => message.role === "lead")?.text ?? "";
    // Pergunta institucional respondível pelas políticas cadastradas da empresa.
    const institutionalPolicies = resolveInstitutionalPolicies(
      lastLeadText,
      params.ctx.grounding.commercialRules,
    );
    const policyReply = (reason: string): AgentDecision => ({
      kind: "reply",
      message: buildInstitutionalPolicyReply(institutionalPolicies ?? []),
      suggested_products: [],
      product_image_ids: [],
      grounding_sources: ["commercial_rules"],
      learning_ids_used: [],
      fallback_reason: reason,
    });
    if (catalogSearch.status !== "matches") {
      if (catalogSearch.status === "query_error") {
        return {
          kind: "handoff",
          reason: "catalog_query_error",
          grounding_sources: groundingSources,
          learning_ids_used: [],
        };
      }
      if (institutionalPolicies) {
        // Pergunta sobre política não depende de produto: segue para o LLM só
        // com as políticas (sem catálogo), validada abaixo.
        return this.decide({
          ...params,
          catalogSearch: { status: "matches", products: [] },
          institutionalOnly: true,
          ctx: {
            ...params.ctx,
            grounding: { ...params.ctx.grounding, catalogSearch: { status: "matches", products: [] } },
          },
        });
      }
      // Pergunta de continuação sobre produtos já apresentados ("tem algum
      // mais em conta?", "qual compensa mais?") não é pedido de item novo: a
      // busca textual não acha um produto na frase, mas o contexto existe.
      // Segue para o LLM com os apresentados em vez de pedir esclarecimento.
      if (
        (catalogSearch.status === "no_match" ||
          (catalogSearch.status === "ambiguous" && catalogSearch.products.length === 0)) &&
        !params.followUpContext
      ) {
        const known = params.priceComparison?.catalog ?? params.ctx.catalogForValidation ?? [];
        const knownById = new Map(known.map((product) => [product.id, product]));
        // Foco resolvido pelo runtime (histórico + memória); sem ele, o último
        // conjunto apresentado no histórico.
        const focusIds = params.focusProductIds?.length
          ? params.focusProductIds
          : getConversationFocusProductIds(params.history);
        const presented = focusIds.flatMap((id) => {
          const product = knownById.get(id);
          return product ? [product] : [];
        });
        if (presented.length > 0) {
          const followUpSearch: SalesAgentCatalogSearch = {
            status: "matches",
            products: presented,
            basis: "focus",
            focusProductIds: presented.map((product) => product.id),
          };
          return this.decide({
            ...params,
            followUpContext: true,
            catalogSearch: followUpSearch,
            ctx: {
              ...params.ctx,
              grounding: { ...params.ctx.grounding, catalogSearch: followUpSearch },
            },
          });
        }
      }
      if (catalogSearch.status === "ambiguous" && catalogSearch.products.length > 1) {
        const options = catalogSearch.products.slice(0, SALES_AGENT_MAX_OPTIONS);
        return {
          kind: "reply",
          message: buildAmbiguityClarification(options),
          suggested_products: options.map((product) => product.id),
          product_image_ids: [],
          grounding_sources: groundingSources,
          learning_ids_used: [],
          clarification: "ambiguous",
          fallback_reason: "catalog_product_ambiguous_clarification",
        };
      }
      if (
        (catalogSearch.status === "no_match" || catalogSearch.status === "ambiguous") &&
        !previousAgentAskedClarification(params.history)
      ) {
        return {
          kind: "reply",
          message: NO_MATCH_CLARIFICATION,
          suggested_products: [],
          product_image_ids: [],
          grounding_sources: groundingSources,
          learning_ids_used: [],
          clarification: "no_match",
          fallback_reason: "catalog_product_not_found_clarification",
        };
      }
      const reason = catalogSearch.status === "empty_catalog"
        ? "catalog_empty"
        : catalogSearch.status === "no_match"
          ? "catalog_product_not_found"
          : "catalog_product_ambiguous";
      return {
        kind: "handoff",
        reason,
        grounding_sources: catalogSearch.status === "empty_catalog" ? [] : groundingSources,
        learning_ids_used: [],
      };
    }
    const automaticProductImageIds = getAutomaticProductImageIds(
      params.history,
      catalogSearch.products,
    );
    const deterministicProducts = params.history.some(
      (message) => message.role === "lead" && message.text.trim().length > 0,
    )
      ? catalogSearch.products
      : [];
    // Busca exaustiva (medida/atributo): todos os compatíveis podem ser
    // apresentados (até o limite de mídia); nas demais, 2–3 opções.
    const maxOptions = catalogSearch.exhaustive
      ? Math.max(SALES_AGENT_MAX_OPTIONS, Math.min(catalogSearch.products.length, MAX_SALES_AGENT_PRODUCT_IMAGES))
      : SALES_AGENT_MAX_OPTIONS;
    const fallbackProducts = deterministicProducts.slice(0, maxOptions);
    const deterministicFallback = (reason: string): AgentDecision =>
      fallbackProducts.length === 0 && institutionalPolicies
        ? policyReply(reason)
        : ({
      ...(fallbackProducts.length > 0
        ? {
            kind: "reply" as const,
            // Pergunta mista (produto + política): catálogo validado + texto da política.
            message: [
              buildValidatedCatalogReply(fallbackProducts, {
                includePrice: customerAskedForPrice(params.history),
              }),
              institutionalPolicies ? buildInstitutionalPolicyReply(institutionalPolicies) : null,
            ].filter(Boolean).join("\n"),
            suggested_products: fallbackProducts.map((product) => product.id),
            product_image_ids: automaticProductImageIds,
          }
        : { kind: "handoff" as const, reason }),
      grounding_sources: groundingSources,
      learning_ids_used: [],
      fallback_reason: reason,
    });
    // Falha do provedor, resposta inválida/sem tool call ou pedido explícito de
    // humano nunca viram resposta automática: handoff seguro, sem listar catálogo.
    const safeHandoff = (reason: string, fallbackReason: string = reason): AgentDecision => ({
      kind: "handoff",
      reason,
      grounding_sources: groundingSources,
      learning_ids_used: [],
      fallback_reason: fallbackReason,
    });
    // Pergunta institucional com política cadastrada: se o provedor falhar,
    // responde com o texto da própria política (determinístico, sem fato novo).
    const providerFailure = (reason: string): AgentDecision =>
      institutionalPolicies ? policyReply(reason) : safeHandoff(reason);
    const completion = await this.complete(buildSalesAgentCompletionRequest(params));
    if (!completion.ok) {
      return providerFailure(completion.reason);
    }
    const data = completion.data;
    const call = data.choices?.[0]?.message?.tool_calls?.[0]?.function;
    if (!call?.name || !call.arguments) {
      return providerFailure("no_tool_call");
    }

    let args: ToolReply | ToolHandoff;
    try {
      args = JSON.parse(call.arguments);
    } catch {
      if (institutionalPolicies) return policyReply("tool_args_parse_fail");
      return {
        kind: "handoff",
        reason: "tool_args_parse_fail",
        grounding_sources: groundingSources,
        learning_ids_used: [],
      };
    }

    if (call.name === "request_human_handoff") {
      return safeHandoff((args as ToolHandoff).reason || "model_requested", "model_requested_handoff");
    }
    if (call.name === COMPARE_CATALOG_PRICES_TOOL) {
      return executePriceComparison(params, args as ToolComparePrices, {
        institutionalPolicies,
        safeHandoff,
      });
    }
    // Turno com palavra de preço ambígua que o LLM não tratou como comparação:
    // mantém a proteção do pré-check (negociação vai para humano).
    if (params.priceSensitive) {
      return safeHandoff("pre_check_price_sensitive", "price_sensitive_not_comparison");
    }
    const reply = args as ToolReply;
    if (!reply.message) {
      return safeHandoff("empty_message");
    }
    if (!replyContinuesAffirmedOffer(reply.message, params.history)) {
      return deterministicFallback("affirmative_continuation_not_answered");
    }
    // Resposta institucional: todo número (parcelas, %, prazo, valor) tem de
    // vir da política cadastrada ou de fato do catálogo deste turno.
    if (
      institutionalPolicies &&
      !replyNumbersAreGrounded(
        reply.message,
        institutionalPolicies,
        catalogSearch.products.flatMap((product) =>
          [product.price, product.promoPrice, product.lengthM, product.widthM, product.depthM, product.capacityL]
            .filter((value): value is number => value != null)
            .map((value) => String(value)),
        ),
      )
    ) {
      return deterministicFallback("institutional_unvalidated_number");
    }
    const isNonFactualReply =
      isNonFactualObjectiveMessage(reply.message) &&
      extractFactualPriceClaims(reply.message, params.history).length === 0;
    const catalogIds = new Set(
      catalogSearch.products.map((product) => product.id),
    );
    const catalogById = new Map(
      catalogSearch.products.map((product) => [product.id, product]),
    );
    const modelSuggestions = Array.isArray(reply.suggest_products)
      ? reply.suggest_products.filter((id): id is string => typeof id === "string")
      : [];
    const modelImageIds = Array.isArray(reply.send_product_images)
      ? reply.send_product_images.filter((id): id is string => typeof id === "string")
      : [];
    if (
      modelSuggestions.some((id) => !catalogIds.has(id)) ||
      modelImageIds.some((id) => !catalogIds.has(id))
    ) {
      return safeHandoff("catalog_invalid_product_reference");
    }
    const requestedSuggestions = modelSuggestions.length > 0
      ? modelSuggestions.slice(0, maxOptions)
      : deterministicProducts.slice(0, maxOptions).map((product) => product.id);
    const selectedProducts = requestedSuggestions.flatMap((id) => {
      const product = catalogById.get(id);
      return product ? [product] : [];
    });
    const learningIdsUsed = Array.isArray(reply.learning_ids_used)
      ? reply.learning_ids_used.filter((id) => availableLearningIds.includes(id))
      : [];
    const catalogForValidation = catalogSearch.products;
    // Diagnóstico de validação: o que o LLM escreveu e com quais fatos de
    // Produtos ele foi validado. Sem isso não há como provar qual afirmação
    // foi rejeitada (o texto rejeitado nunca é enviado nem era gravado).
    const validationDiagnostic = (check: string): SalesAgentValidationDiagnostic => ({
      check,
      rejected_reply: reply.message.slice(0, 600),
      suggested_product_ids: modelSuggestions.slice(0, 10),
      catalog_basis: catalogSearch.basis ?? "reference",
      validated_products: catalogSearch.products.slice(0, 10).map((product) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        promo_price: product.promoPrice,
      })),
    });
    if (
      !validateObjectiveProductClaims(
        reply.message,
        catalogForValidation,
        requestedSuggestions,
        params.ctx.grounding.commercialRules,
        params.history,
      )
    ) {
      const diagnostic = validationDiagnostic("objective_claim");
      if (institutionalPolicies) {
        return { ...deterministicFallback("catalog_unvalidated_objective_claim"), validation_diagnostic: diagnostic };
      }
      return {
        kind: "handoff",
        reason: "catalog_unvalidated_objective_claim",
        grounding_sources: groundingSources,
        learning_ids_used: learningIdsUsed,
        validation_diagnostic: diagnostic,
      };
    }
    if (
      !isNonFactualReply && !messageHasOnlyValidatedProductFacts(
        reply.message,
        selectedProducts,
        catalogSearch.products,
      )
    ) {
      return {
        ...deterministicFallback("catalog_invalid_product_fact"),
        validation_diagnostic: validationDiagnostic("product_fact"),
      };
    }
    if (
      !isNonFactualReply &&
      messageClaimsProductReference(reply.message) &&
      requestedSuggestions.length === 0
    ) {
      return deterministicFallback("catalog_unvalidated_product_claim");
    }
    // Preço afirmado (com ou sem "R$", com ou sem pergunta depois) só sai se
    // for exatamente o preço cadastrado de um produto do turno.
    // (Em resposta institucional os números já foram validados contra política
    // + catálogo acima; valores da política, ex. entrada, não são preço de produto.)
    const factualPriceClaims = extractFactualPriceClaims(reply.message, params.history);
    if (factualPriceClaims.length > 0 && !institutionalPolicies) {
      if (selectedProducts.length === 0) {
        return { ...safeHandoff("catalog_unvalidated_price_claim"), validation_diagnostic: validationDiagnostic("price_claim") };
      }
      if (!factualPriceClaimsMatchProducts(factualPriceClaims, selectedProducts)) {
        return {
          ...deterministicFallback("catalog_unvalidated_price_claim"),
          validation_diagnostic: validationDiagnostic("price_claim"),
        };
      }
    }
    const promisedImageIds = messagePromisesProductPresentation(reply.message)
      ? selectedProducts.filter((product) => product.images.length > 0).map((product) => product.id)
      : [];
    const requestedImages = [...new Set([
      ...automaticProductImageIds,
      ...modelImageIds,
      ...promisedImageIds,
    ])]
      .filter((id) => (catalogById.get(id)?.images.length ?? 0) > 0)
      .slice(0, 10);
    // Sales Intelligence: a próxima ação escolhida pelo LLM passa pelo gate
    // de capacidades/limites da empresa (o texto já foi validado acima).
    const parsedPlan = parseSalesTurnPlan(reply.sales_plan);
    let salesPlan: SalesTurnPlan | null = null;
    let afterReply: AgentDecision["after_reply"] = null;
    if (parsedPlan) {
      const gate = gateSalesTurnPlan(parsedPlan, {
        knowledge: buildBusinessKnowledge(params.ctx),
        suggestedProductIds: modelSuggestions,
      });
      if (gate.outcome === "handoff") {
        return { ...safeHandoff(gate.reason), sales_plan: gate.plan };
      }
      salesPlan = gate.plan;
      afterReply = gate.afterReply;
    }
    const stageRaw = reply.customer_stage?.toLowerCase().trim();
    const stage: CustomerStage | null =
      stageRaw === "curioso" || stageRaw === "pesquisando" || stageRaw === "pronto_para_comprar"
        ? stageRaw
        : null;
    return {
      kind: "reply",
      message: reply.message,
      detected_city: reply.detected_city ?? null,
      detected_state: normalizeState(reply.detected_state) ?? reply.detected_state ?? null,
      detected_pool_size: reply.detected_pool_size ?? null,
      detected_intent: reply.detected_intent ?? null,
      detected_interest: reply.detected_interest ?? null,
      detected_budget: reply.detected_budget ?? null,
      purchase_timing: normalizeTiming(reply.purchase_timing) ?? null,
      customer_stage: stage,
      suggested_products: requestedSuggestions,
      product_image_ids: requestedImages,
      grounding_sources: groundingSources,
      learning_ids_used: learningIdsUsed,
      presented_product_ids: presentedInReply(reply.message, modelSuggestions, catalogSearch.products),
      ...(salesPlan ? { sales_plan: salesPlan, after_reply: afterReply } : {}),
    };
  }
}

/** IDs sugeridos pelo LLM ou, sem sugestão, produtos citados pelo nome no texto. */
function presentedInReply(
  message: string,
  suggested: readonly string[],
  products: SalesAgentGrounding["catalog"],
): string[] {
  if (suggested.length > 0) return [...new Set(suggested)];
  const normalized = comparablePromptText(message);
  return products
    .filter((product) =>
      [product.name, product.model]
        .filter((value): value is string => Boolean(value?.trim()))
        .some((value) => normalized.includes(comparablePromptText(value))),
    )
    .map((product) => product.id);
}
