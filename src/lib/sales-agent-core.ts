import {
  normalizeState,
  normalizeTiming,
  type CustomerStage,
  type PurchaseTiming,
} from "./ai-qualifier.server";
import { SALES_AGENT_MAX_OPTIONS, SALES_AGENT_PLAYBOOK } from "./sales-agent-playbook";
import type { ActiveCoachRuleGrounding } from "./coach-rules/coach-rules.repository";
import type { QuickReplyGrounding } from "./quick-replies/quick-replies.repository";
import { resolveCatalogProductReference } from "./sales-agent-product-resolution";
import { MAX_SALES_AGENT_PRODUCT_IMAGES } from "./sales-agent-product-images";

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
  }>;
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
}

export interface SalesAgentCoreInput {
  ctx: AgentContext;
  history: Array<{ role: "lead" | "agent" | "system"; text: string }>;
  leadName: string | null;
  model: string;
  sessionCorrections?: Array<{ question: string; correction: string }>;
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
}

interface ToolHandoff {
  reason: string;
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
  const explicit = /comprimento\s*(?:de)?\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:m|metros?)?\b/.exec(
    normalized,
  );
  const mentionsOtherDimension = /\b(?:largura|profundidade)\b/.test(normalized);
  const generic = mentionsOtherDimension
    ? null
    : /(?:^|\D)(\d{1,2}(?:[.,]\d+)?)\s*(?:m|metros?)\b/.exec(normalized);
  const raw = dimension?.[1] ?? explicit?.[1] ?? generic?.[1];
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
  const claimedMeasures = [...normalized.matchAll(/(\d{1,2}(?:[.,]\d+)?)\s*(?:m|metros?)\b/g)]
    .map((match) => Number(match[1].replace(",", ".")))
    .filter(Number.isFinite);
  const validMeasures = new Set(
    selectedProducts.flatMap((product) =>
      [product.lengthM, product.widthM, product.depthM].filter(
        (value): value is number => value != null,
      ),
    ),
  );
  if (!claimedMeasures.every((measure) => validMeasures.has(measure))) return false;
  const claimedPrices = [...message.matchAll(/R\$\s*([\d.]+(?:,\d{1,2})?)/gi)]
    .map((match) => Number(match[1].replace(/\./g, "").replace(",", ".")))
    .filter(Number.isFinite);
  const validPrices = new Set(
    selectedProducts.flatMap((product) => {
      const effectivePrice =
        product.promoPrice != null && Number.isFinite(product.promoPrice) && product.promoPrice > 0
          ? product.promoPrice
          : product.price != null && Number.isFinite(product.price) && product.price > 0
            ? product.price
            : null;
      return effectivePrice == null ? [] : [effectivePrice];
    }),
  );
  if (!claimedPrices.every((price) => validPrices.has(price))) return false;
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

function validateObjectiveProductClaims(
  message: string,
  products: SalesAgentGrounding["catalog"] | undefined,
  suggestedProductIds: string[],
  history: SalesAgentCoreInput["history"],
): boolean {
  if (isNonFactualObjectiveMessage(message)) return true;
  const objectiveSentences = objectiveClaimSentences(message);
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
    .filter((claim): claim is { value: number; promo: boolean; index: number } => claim.value != null)
    .filter((claim, index, claims) => claims.findIndex((item) => item.index === claim.index) === index);
  const standaloneMoney = message.trim().match(/^([\d.]+(?:,\d{1,2})?)(?:\s*(mil|k))?$/i);
  if (standaloneMoney && hasMonetaryContext(message, history)) {
    const value = parseMoneyClaim(standaloneMoney[1], standaloneMoney[2]);
    if (value != null) priceClaims.push({ value, promo: false, index: 0 });
  }
  const dimensionClaims = [...message.matchAll(
    /(\d{1,2}(?:[.,]\d+)?)\s*[x×]\s*(\d{1,2}(?:[.,]\d+)?)(?:\s*[x×]\s*(\d{1,2}(?:[.,]\d+)?))?\s*(?:m|metros?)?/gi,
  )]
    .filter((match) => /\b(?:m|metros?)\b/i.test(match[0]))
    .map((match) => match.slice(1).filter(Boolean).map((value) => parseCatalogNumber(value)));
  const capacityClaims = [...message.matchAll(/([\d.]+(?:,\d+)?)\s*l(?:itros?)?\b/gi)]
    .map((match) => parseCatalogNumber(match[1]))
    .filter((value): value is number => value != null);
  const hasObjectiveValue = priceClaims.length > 0 || dimensionClaims.length > 0 || capacityClaims.length > 0 || objectiveSentences.length > 0;
  if (!hasObjectiveValue) return true;
  if (!products) return false;

  const normalizedMessage = comparablePromptText(message);
  const resolvedProduct = resolveCatalogProductReference(message, products);
  if (resolvedProduct.ambiguous) return false;
  const byMention = resolvedProduct.product
    ? [resolvedProduct.product]
    : products.filter((product) =>
    [product.name, product.model]
      .filter((value): value is string => Boolean(value))
      .some((value) => normalizedMessage.includes(comparablePromptText(value))),
      );
  const candidates = byMention;
  if (candidates.length === 0) return true;

  if (priceClaims.some((claim) =>
    !candidates.some((product) => {
      if (claim.promo) {
        return product.promoPrice != null && sameCatalogNumber(product.promoPrice, claim.value);
      }
      return [product.price, product.promoPrice]
        .some((price) => price != null && sameCatalogNumber(price, claim.value));
    }),
  )) return false;

  if (dimensionClaims.some((claim) => {
    const dimensions = claim.filter((value): value is number => value != null);
    return !candidates.some((product) => {
      const productDimensions = [product.lengthM, product.widthM, product.depthM]
        .filter((value): value is number => value != null);
      return dimensions.length <= productDimensions.length && dimensions.every((value, index) =>
        sameCatalogNumber(value, productDimensions[index]),
      );
    });
  })) return false;

  if (capacityClaims.some((claim) =>
    !candidates.some((product) => product.capacityL != null && sameCatalogNumber(product.capacityL, claim)),
  )) return false;

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
    components: comparablePromptText((product.includedItems ?? []).join(" ")),
  }));
  return objectiveSentences.every((sentence) => {
    const normalizedSentence = comparablePromptText(sentence);
    const relevantFacts = /\bmodelo\b/.test(normalizedSentence)
      ? semanticFacts.map((facts) => facts.model).join(" ")
      : /\bcor\b/.test(normalizedSentence)
        ? semanticFacts.map((facts) => facts.color).join(" ")
        : /\bformato\b/.test(normalizedSentence)
          ? semanticFacts.map((facts) => facts.shape).join(" ")
          : /\b(?:material|fibra|vinil)\b/.test(normalizedSentence)
            ? semanticFacts.flatMap((facts) => facts.specifications
              .filter((specification) => /material|composicao|revestimento|tipo/.test(specification.key))
              .map((specification) => `${specification.key} ${specification.value}`)).join(" ")
            : /\b(?:filtro|bomba|inclus[oa]s?)\b/.test(normalizedSentence)
              ? semanticFacts.flatMap((facts) => [facts.components, ...facts.specifications
                .filter((specification) => /filtro|bomba|motobomba|inclus/.test(specification.key))
                .map((specification) => `${specification.key} ${specification.value}`)]).join(" ")
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
    if (technicalFieldClaim) {
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
    if (!/\b(?:modelo|formato|material|fibra|vinil|cor|acabamento|estrutura|filtro|bomba|pot[eÃª]ncia|voltagem|tens[aÃ£]o|instala[cÃ§][aÃ£]o|inclus[oa]s?|aquecimento|aqueci|drenagem)\b/i.test(normalizedSentence)) {
      return true;
    }
    return claimTokens.every((token) => relevantFacts.includes(token));
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
): string {
  const ai = ctx.aiProfile;
  const usesGroundedCatalog = ctx.grounding.catalog.length > 0;
  const groundedProducts = usesGroundedCatalog ? ctx.grounding.catalog : ctx.products;
  const relevantFaqs = selectRelevantFaqs(
    ctx.grounding.faqKnowledge,
    ai?.faq ?? [],
    ctx.knowledge,
    history,
  );
  const productLines = groundedProducts
    .map((p, i) => {
      const parts = [`${i + 1}. ${p.name} (ID: ${p.id})`];
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

  return `Você é "${ctx.settings.ai_agent_name}", pré-atendente automático da empresa "${ctx.companyName}".
Você atende clientes via WhatsApp/Instagram FORA do horário comercial enquanto o vendedor humano não chega.

${SALES_AGENT_PLAYBOOK}

REGRAS INVIOLÁVEIS (se violar, peça handoff imediato):
- NUNCA invente nem negocie desconto, preço, parcelamento ou condição comercial. Você pode informar o preço exato cadastrado no produto; use o preço promocional válido quando existir, senão o preço normal.
- Perguntas normais sobre prazo de carga/instalação devem ser respondidas pelas REGRAS DE CARGA E INSTALAÇÃO cadastradas abaixo; só informe a próxima carga quando perguntarem sobre prazo, entrega ou instalação, e nunca prometa uma data.
- NUNCA invente informação que não esteja no contexto abaixo.
- NUNCA feche venda sozinho — apenas qualifique o lead.
- Para perguntas sobre prazo de carga/instalação, só chame request_human_handoff se o cliente exigir uma data específica ou antecipada que dependa de confirmação humana.

CONTEXTO DA EMPRESA:
- Tom: ${ai?.tone ?? "comercial"}
- Descrição: ${ai?.description ?? "—"}
- Região atendida: ${ai?.region ?? "—"}
- Diferenciais: ${ai?.differentials ?? "—"}
- Pagamento (apenas mencionar formas, sem negociar): ${ctx.grounding.commercialRules.paymentPolicy || ctx.grounding.commercialRules.paymentMethods ? "—" : ai?.payment_methods ?? "—"}

CATÁLOGO (use apenas estes produtos):
${productLines || "(catálogo vazio)"}

REGRA DE REFERÊNCIA DE PRODUTO:
- Todo produto mencionado na resposta deve estar no CATÁLOGO acima e também ter seu ID incluído em suggest_products.
- Nunca use FAQ, histórico ou aprendizados como fonte de nome, modelo, medida, preço ou especificação de produto.
- Se o produto ou especificação pedida não estiver no catálogo, não proponha alternativa inventada: solicite atendimento humano.
- Em piscinas, variações como "quadrada", "quadrado", plurais, erros de gênero e "reta" significam intenção provável por linhas retas. Confirme esse entendimento naturalmente e use somente produtos cujo formato real no catálogo seja reto/retangular; nunca altere nem chame o formato real de quadrado.

FAQ:
${faqLines || "(sem faq cadastrado)"}

BASE DE CONHECIMENTO APROVADA:
${kbLines || "(vazia)"}${groundingSections ? `\n\n${groundingSections}` : ""}

SUA MISSÃO:
1. Cumprimentar e identificar: cidade da instalação + tamanho/medida da piscina + interesse principal.
2. Quando tiver os dados, sugerir produtos compatíveis do catálogo.
3. Responder dúvidas básicas (inclusos/por conta, dimensões) usando catálogo + KB.
4. Se faltar dado ou pergunta sair do escopo → request_human_handoff com lowConfidence=true.
5. Preencha send_product_images quando o cliente pedir fotos/imagens/modelos OU quando sua resposta prometer mostrar, enviar ou apresentar produtos. Use somente IDs com fotos cadastradas, nunca invente IDs ou URLs e selecione no máximo 10 produtos.
6. Em pedidos por comprimento, apresente TODOS os produtos do catálogo com o comprimento correspondente. Se o cliente apenas demonstrar interesse pela medida, responda em uma frase curta e natural, sem listar preços, dimensões ou litragem; só informe esses fatos se forem pedidos. Ausência de fotos ou de informação de disponibilidade não justifica handoff: não afirme disponibilidade e envie apenas fotos realmente cadastradas.

Sempre retorne via tool call (respond_to_customer OU request_human_handoff). Texto deve ser pt-BR, máx 4 frases, humano e sem clichês.`;
}

export function buildSalesAgentCompletionRequest(
  params: SalesAgentCoreInput,
): SalesAgentCompletionRequest {
  const catalogProducts =
    params.ctx.grounding.catalog.length > 0 ? params.ctx.grounding.catalog : params.ctx.products;
  const transcriptEntries = params.history
    .slice(-20)
    .map(
      (m) =>
        `${m.role === "lead" ? "Cliente" : m.role === "agent" ? "Atendente" : "Sistema"}: ${m.text}`,
    );
  const sessionCorrections = (params.sessionCorrections ?? [])
    .map(
      (item, index) =>
        `${index + 1}. Pergunta anterior: ${item.question}\n   Correção salva: ${item.correction}`,
    )
    .join("\n");
  const sessionCorrectionsBlock = sessionCorrections
    ? `\n\nCORREÇÕES APROVADAS DESTA SESSÃO:\n${sessionCorrections}\n\nEstas correções têm prioridade sobre os aprendizados do Coach apenas como comportamento e instrução de atendimento. Nunca use uma correção como fonte de fatos de produto ou políticas comerciais: catálogo e POLÍTICAS OFICIAIS continuam soberanos.`
      : "";
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
      { role: "system", content: buildSalesAgentSystemPrompt(params.ctx, params.history) },
      {
        role: "user",
      content: `Lead: ${params.leadName ?? "—"}\n\nConversa até agora:\n${transcript.join("\n")}${sessionCorrectionsBlock}\n\nResponda agora seguindo primeiro as correções desta sessão quando forem relevantes.`,
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
              detected_city: { type: "string", description: "Cidade da instalação." },
              detected_state: { type: "string", description: "Estado/UF (ex.: SP, RJ)." },
              detected_pool_size: { type: "string", description: "Medida/tamanho da piscina." },
              detected_intent: {
                type: "string",
                description: "Intenção principal (informação, orçamento, instalação, etc.).",
              },
              detected_interest: {
                type: "string",
                description: "Interesse específico (piscina fibra, aquecimento, lona, manutenção).",
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
                    enum: catalogProducts.map((product) => product.id),
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
                  enum: params.ctx.grounding.approvedCoachLearnings.map((learning) => learning.id),
                },
                description:
                  "IDs dos aprendizados do Coach que influenciaram materialmente esta resposta. Não inclua aprendizados apenas por estarem no contexto.",
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

export class SalesAgentCore {
  constructor(private readonly complete: SalesAgentCompletion) {}

  async decide(params: SalesAgentCoreInput): Promise<AgentDecision> {
    const groundingSources = getSalesAgentGroundingSources(params.ctx);
    const availableLearningIds = params.ctx.grounding.approvedCoachLearnings.map(
      (learning) => learning.id,
    );
    const requestedLength = getRequestedProductLength(params.history);
    const lengthMatches =
      requestedLength == null
        ? []
        : params.ctx.grounding.catalog.filter((product) => product.lengthM === requestedLength);
    const fallbackProducts =
      lengthMatches.length > 0
        ? lengthMatches
        : customerAskedAboutProducts(params.history)
          ? params.ctx.grounding.catalog
          : [];
    const automaticProductImageIds = getAutomaticProductImageIds(
      params.history,
      params.ctx.grounding.catalog,
    );
    const shouldUseBriefReply = shouldUseBriefMeasureReply(
      params.history,
      lengthMatches.length > 0,
    );
    const deterministicFallback = (reason: string): AgentDecision =>
      fallbackProducts.length > 0
        ? {
            kind: "reply",
            message: shouldUseBriefReply
              ? buildBriefMeasureReply()
              : buildValidatedCatalogReply(fallbackProducts, {
                  rectangularPoolIntent: hasRectangularPoolIntent(params.history),
                  includePrice: customerAskedForPrice(params.history),
                }),
            suggested_products: fallbackProducts.map((product) => product.id),
            product_image_ids: automaticProductImageIds,
            grounding_sources: groundingSources,
            learning_ids_used: [],
          }
        : {
            kind: "handoff",
            reason,
            grounding_sources: groundingSources,
            learning_ids_used: [],
          };
    if (params.ctx.grounding.catalog.length === 0 && customerAskedAboutProducts(params.history)) {
      return {
        kind: "handoff",
        reason: "catalog_product_not_found",
        grounding_sources: groundingSources,
        learning_ids_used: [],
      };
    }
    const completion = await this.complete(buildSalesAgentCompletionRequest(params));
    if (!completion.ok) {
      return deterministicFallback(completion.reason);
    }
    const data = completion.data;
    const call = data.choices?.[0]?.message?.tool_calls?.[0]?.function;
    if (!call?.name || !call.arguments) {
      return deterministicFallback("no_tool_call");
    }

    let args: ToolReply | ToolHandoff;
    try {
      args = JSON.parse(call.arguments);
    } catch {
      return {
        kind: "handoff",
        reason: "tool_args_parse_fail",
        grounding_sources: groundingSources,
        learning_ids_used: [],
      };
    }

    if (call.name === "request_human_handoff") {
      return deterministicFallback((args as ToolHandoff).reason || "model_requested");
    }
    const reply = args as ToolReply;
    if (!reply.message) {
      return deterministicFallback("empty_message");
    }
    const isSessionCorrection = (params.sessionCorrections ?? []).some(
      ({ correction }) => correction.trim() === reply.message.trim(),
    );
    const isNonFactualReply = isNonFactualObjectiveMessage(reply.message);
    const catalogIds = new Set(
      params.ctx.catalogProductIds ??
        params.ctx.grounding.catalog.map((product) => product.id),
    );
    const catalogById = new Map(
      params.ctx.grounding.catalog.map((product) => [product.id, product]),
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
      return deterministicFallback("catalog_invalid_product_reference");
    }
    const requestedSuggestions =
      lengthMatches.length > 0
        ? lengthMatches.map((product) => product.id)
        : modelSuggestions.length === 0 &&
            customerAskedAboutProducts(params.history) &&
            params.ctx.grounding.catalog.length === 1
          ? [params.ctx.grounding.catalog[0].id]
          : modelSuggestions.slice(0, SALES_AGENT_MAX_OPTIONS);
    const selectedProducts = requestedSuggestions.flatMap((id) => {
      const product = catalogById.get(id);
      return product ? [product] : [];
    });
    const learningIdsUsed = Array.isArray(reply.learning_ids_used)
      ? reply.learning_ids_used.filter((id) => availableLearningIds.includes(id))
      : [];
    const catalogForValidation = params.ctx.catalogForValidation;
    if (
      !isSessionCorrection &&
      !validateObjectiveProductClaims(reply.message, catalogForValidation, requestedSuggestions, params.history)
    ) {
      return {
        kind: "handoff",
        reason: "catalog_unvalidated_objective_claim",
        grounding_sources: groundingSources,
        learning_ids_used: learningIdsUsed,
      };
    }
    if (
      !isSessionCorrection && !isNonFactualReply && !messageHasOnlyValidatedProductFacts(
        reply.message,
        selectedProducts,
        params.ctx.grounding.catalog,
      )
    ) {
      return deterministicFallback("catalog_invalid_product_fact");
    }
    if (
      !isSessionCorrection &&
      !isNonFactualReply &&
      messageClaimsProductReference(reply.message) &&
      requestedSuggestions.length === 0
    ) {
      return deterministicFallback("catalog_unvalidated_product_claim");
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
    const stageRaw = reply.customer_stage?.toLowerCase().trim();
    const stage: CustomerStage | null =
      stageRaw === "curioso" || stageRaw === "pesquisando" || stageRaw === "pronto_para_comprar"
        ? stageRaw
        : null;
    return {
      kind: "reply",
      message: !isSessionCorrection && shouldUseBriefReply
        ? buildBriefMeasureReply()
        : reply.message,
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
    };
  }
}
