import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { listLearningCandidates } from "./coach-learnings/coach-learnings.repository";
import { retrieveLearnings } from "./coach-learnings/retriever";
import { getRequestedProductLength, type SalesAgentGrounding } from "./sales-agent-core";
import { SALES_AGENT_MAX_OPTIONS } from "./sales-agent-playbook";
import type {
  ConversationProductAttributes,
  ConversationSalesState,
} from "./conversation-sales-state";
import type { ActiveCoachRuleGrounding } from "./coach-rules/coach-rules.repository";
import {
  listActiveQuickRepliesForGrounding,
  type QuickReplyGrounding,
} from "./quick-replies/quick-replies.repository";

export type AgentHistory = Array<{
  role: "lead" | "agent" | "system";
  text: string;
  productIds?: string[];
}>;
type CatalogProduct = SalesAgentGrounding["catalog"][number];
export type ProductSelectionContext = {
  detectedPoolSize?: string | null;
  detectedInterest?: string | null;
  detectedIntent?: string | null;
  detectedBudget?: string | null;
};

const PLAYBOOK_RULE_CATEGORIES = new Set([
  "identity",
  "tone",
  "qualification",
  "human_handoff",
]);
const COACH_RULE_CATEGORY_TERMS: Record<string, string[]> = {
  sales: ["piscina", "modelo", "medida", "tamanho", "instal"],
  pricing: ["preco", "valor", "orcamento"],
  payments: ["pagamento", "parcel", "pix", "cartao", "boleto", "entrada"],
  discounts: ["desconto", "negoci"],
  negotiation: ["desconto", "negoci", "condicao"],
  after_sales: ["garantia", "casco", "estrutura", "filtro", "motobomba"],
  prohibitions: ["invent", "promet", "preco", "desconto"],
  safety: ["segur", "risco", "instal", "acesso"],
};

const QUICK_REPLY_MAX_CANDIDATES = 20;
const QUICK_REPLY_MAX_SELECTED = 2;
const QUICK_REPLY_MAX_CONTENT_CHARS = 500;
const QUICK_REPLY_TOPIC_TERMS: Record<string, string[]> = {
  inclusos: ["inclus", "brinde", "item", "itens"],
  responsabilidade: [
    "por conta",
    "responsabilidade",
    "cliente fornece",
    "cliente precisa",
    "contrapiso",
    "piso",
    "agua",
    "energia",
    "drenagem",
    "pluvial",
    "retirada",
    "terra",
    "material",
    "materiais",
  ],
  instalacao: ["instal", "escav", "obra", "casa de maquina"],
  faq: ["horario", "endereco", "prazo", "entrega", "atendimento", "link"],
  payment: ["pagamento", "pix", "cartao", "boleto", "parcel", "entrada"],
  guarantee: ["garantia", "garantias", "casco"],
};
const NON_OPERATIONAL_QUICK_REPLY_CATEGORIES = new Set([
  "identity",
  "tom",
  "tone",
  "qualification",
  "human_handoff",
]);

export interface QuickReplyDedupSources {
  paymentMethods?: string | null;
  guarantees?: string | null;
  coachRules?: Array<{ title?: string | null; content?: string | null }>;
  playbook?: string | null;
  catalog?: Array<Record<string, unknown> | string>;
}

function quickReplyConversation(
  history: AgentHistory,
  context: ProductSelectionContext = {},
): string {
  return normalizeCatalogText(
    [
      ...history.slice(-8).filter((item) => item.role !== "system").map((item) => item.text),
      context.detectedPoolSize,
      context.detectedInterest,
      context.detectedIntent,
      context.detectedBudget,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function sourceText(source: Record<string, unknown> | string): string {
  if (typeof source === "string") return source;
  return Object.values(source)
    .filter((value) => typeof value === "string" || Array.isArray(value))
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function significantTokens(value: string): Set<string> {
  const stopwords = new Set([
    "para",
    "como",
    "com",
    "uma",
    "dos",
    "das",
    "que",
    "por",
    "cliente",
    "piscina",
  ]);
  return new Set(
    normalizeCatalogText(value)
      .split(/\s+/)
      .map((token) => token.replace(/[^a-z0-9]/g, ""))
      .filter((token) => token.length >= 4 && !stopwords.has(token)),
  );
}

function overlapsStructuredSource(replyText: string, source: string): boolean {
  const reply = normalizeCatalogText(replyText);
  const normalizedSource = normalizeCatalogText(source);
  if (!reply || !normalizedSource) return false;
  if (reply.includes(normalizedSource) || normalizedSource.includes(reply)) return true;
  const sourceTokens = significantTokens(normalizedSource);
  const sharedTokens = [...significantTokens(reply)].filter((token) => sourceTokens.has(token));
  return sharedTokens.length >= 2;
}

function duplicatesStructuredSource(
  reply: QuickReplyGrounding,
  sources: QuickReplyDedupSources,
): boolean {
  const replyText = `${reply.name} ${reply.category ?? ""} ${reply.content}`;
  const replyTopics = normalizeCatalogText(replyText);
  if (
    sources.paymentMethods &&
    QUICK_REPLY_TOPIC_TERMS.payment.some((term) => replyTopics.includes(term))
  ) {
    return true;
  }
  if (
    sources.guarantees &&
    QUICK_REPLY_TOPIC_TERMS.guarantee.some((term) => replyTopics.includes(term))
  ) {
    return true;
  }
  const otherSources = [
    ...(sources.coachRules ?? []).map((rule) => `${rule.title ?? ""} ${rule.content ?? ""}`),
    sources.playbook ?? "",
    ...(sources.catalog ?? []).map(sourceText),
  ];
  return otherSources.some((source) => overlapsStructuredSource(replyText, source));
}

function truncateQuickReply(reply: QuickReplyGrounding): QuickReplyGrounding {
  if (reply.content.length <= QUICK_REPLY_MAX_CONTENT_CHARS) return reply;
  return {
    ...reply,
    content: `${reply.content.slice(0, QUICK_REPLY_MAX_CONTENT_CHARS - 1).trimEnd()}…`,
  };
}

export function selectRelevantSalesAgentQuickReplies(
  replies: QuickReplyGrounding[],
  history: AgentHistory,
  context: ProductSelectionContext = {},
  sources: QuickReplyDedupSources = {},
): QuickReplyGrounding[] {
  const conversation = quickReplyConversation(history, context);
  if (!conversation) return [];

  const scored = replies
    .filter(
      (reply) =>
        !NON_OPERATIONAL_QUICK_REPLY_CATEGORIES.has(
          normalizeCatalogText(reply.category ?? "").trim(),
        ),
    )
    .filter((reply) => !duplicatesStructuredSource(reply, sources))
    .map((reply, index) => {
      const haystack = normalizeCatalogText(
        `${reply.name} ${reply.category ?? ""} ${reply.content}`,
      );
      const matchedTopics = Object.values(QUICK_REPLY_TOPIC_TERMS).filter((terms) =>
        terms.some((term) => conversation.includes(term) && haystack.includes(term)),
      ).length;
      const directNameOrCategory = normalizeCatalogText(
        `${reply.name} ${reply.category ?? ""}`,
      );
      const directMatch = Object.values(QUICK_REPLY_TOPIC_TERMS).some((terms) =>
        terms.some((term) => conversation.includes(term) && directNameOrCategory.includes(term)),
      );
      return { reply, index, score: matchedTopics * 100 + (directMatch ? 25 : 0) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return scored.slice(0, QUICK_REPLY_MAX_SELECTED).map((entry) =>
    truncateQuickReply(entry.reply),
  );
}

export async function loadRelevantSalesAgentQuickReplies(
  companyId: string,
  history: AgentHistory,
  context: ProductSelectionContext = {},
  sources: QuickReplyDedupSources = {},
): Promise<QuickReplyGrounding[]> {
  try {
    const candidates = await listActiveQuickRepliesForGrounding(
      companyId,
      supabaseAdmin,
      QUICK_REPLY_MAX_CANDIDATES,
    );
    return selectRelevantSalesAgentQuickReplies(candidates, history, context, sources);
  } catch {
    console.warn("[SALES_AGENT_QUICK_REPLIES_LOAD_FAILED]", { source: "quick_replies" });
    return [];
  }
}

export function selectRelevantSalesAgentCoachRules(
  rules: ActiveCoachRuleGrounding[],
  history: AgentHistory,
  context: ProductSelectionContext = {},
): ActiveCoachRuleGrounding[] {
  const conversation = normalizeCatalogText(
    [
      ...history.slice(-8).filter((item) => item.role !== "system").map((item) => item.text),
      context.detectedPoolSize,
      context.detectedInterest,
      context.detectedIntent,
      context.detectedBudget,
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (!conversation) return [];

  const scored = rules
    .filter((rule) => !PLAYBOOK_RULE_CATEGORIES.has(rule.category))
    .map((rule, index) => {
      const ruleText = normalizeCatalogText(`${rule.title} ${rule.content}`);
      const terms = ruleText.split(/\s+/).filter((term) => term.length >= 4);
      const overlap = terms.filter((term) => conversation.includes(term)).length;
      const categoryTerms = COACH_RULE_CATEGORY_TERMS[rule.category] ?? [];
      const categoryMatch = categoryTerms.some((term) => conversation.includes(term));
      const directTopicMatch = categoryTerms.some(
        (term) => conversation.includes(term) && ruleText.includes(term),
      );
      const score = categoryMatch ? 100 + (directTopicMatch ? 25 : 0) + overlap * 5 : 0;
      return { rule, index, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.rule.priority - a.rule.priority || a.index - b.index);

  const selected: ActiveCoachRuleGrounding[] = [];
  const categories = new Set<string>();
  for (const entry of scored) {
    if (selected.length >= SALES_AGENT_MAX_OPTIONS) break;
    if (!categories.has(entry.rule.category)) {
      selected.push(entry.rule);
      categories.add(entry.rule.category);
    }
  }
  for (const entry of scored) {
    if (selected.length >= SALES_AGENT_MAX_OPTIONS) break;
    if (!selected.some((rule) => rule.ruleId === entry.rule.ruleId)) selected.push(entry.rule);
  }
  return selected;
}

function normalizeCatalogText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function collectVariantTerms(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = normalizeCatalogText(value).trim();
    return normalized.length >= 2 ? [normalized] : [];
  }
  if (Array.isArray(value)) return value.flatMap(collectVariantTerms);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(collectVariantTerms);
  }
  return [];
}

function rankRelevantProducts(products: CatalogProduct[], history: AgentHistory): CatalogProduct[] {
  const recentText = normalizeCatalogText(
    history
      .slice(-8)
      .filter((item) => item.role !== "system")
      .map((item) => item.text)
      .join(" "),
  );
  const recentTokens = new Set(recentText.split(/\s+/).filter((token) => token.length >= 3));
  const mentionedIds = new Set(
    history
      .slice(-8)
      .filter((item) => item.role === "agent")
      .flatMap((item) => item.productIds ?? []),
  );

  return products
    .map((product, index) => {
      const searchable = normalizeCatalogText(
        [
          product.name,
          product.model,
          product.sku,
          product.category,
          product.description,
          product.notes,
        ]
          .filter(Boolean)
          .join(" "),
      );
      const productTokens = searchable.split(/\s+/).filter((token) => token.length >= 3);
      const overlap = productTokens.filter((token) => recentTokens.has(token)).length;
      const exactModel = [product.model, product.sku]
        .filter((value): value is string => Boolean(value?.trim()))
        .some((value) => recentText.includes(normalizeCatalogText(value)));
      const score =
        (mentionedIds.has(product.id) ? 1_000 : 0) + (exactModel ? 100 : 0) + overlap * 5;
      return { product, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ product }) => product);
}

export function extractCurrentProductAttributes(
  history: AgentHistory,
): ConversationProductAttributes {
  const lastLeadText = [...history].reverse().find((item) => item.role === "lead")?.text ?? "";
  const normalized = normalizeCatalogText(lastLeadText);
  const decimal = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  const dimension =
    /(?:^|\D)(\d{1,2}(?:[.,]\d+)?)\s*[x×]\s*(\d{1,2}(?:[.,]\d+)?)(?:\s*[x×]\s*(\d{1,2}(?:[.,]\d+)?))?/.exec(
      normalized,
    );
  const width = /largura\s*(?:de)?\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:m|metros?)?\b/.exec(
    normalized,
  );
  const depth = /profundidade\s*(?:de)?\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:m|metros?)?\b/.exec(
    normalized,
  );
  const capacity = /(\d+(?:[.,]\d+)?)\s*(mil\s*)?(?:l|litros?)\b/.exec(normalized);
  const capacityBase = decimal(capacity?.[1]);
  const variant = /\b(?:cor|variante)\s+(?:(?:na|em|de)\s+)?([\p{L}\d-]+)/u.exec(normalized);
  const asksRectangular = /\b(?:quadrad[ao]s?|ret[ao]s?)\b/.test(normalized);
  const shape = asksRectangular
    ? "retangular"
    : (["retangular", "redond", "oval"].find((term) => normalized.includes(term)) ?? undefined);
  const lengthM = getRequestedProductLength(history);
  return {
    ...(lengthM != null ? { lengthM } : {}),
    ...(decimal(dimension?.[2] ?? width?.[1]) != null
      ? { widthM: decimal(dimension?.[2] ?? width?.[1]) }
      : {}),
    ...(decimal(dimension?.[3] ?? depth?.[1]) != null
      ? { depthM: decimal(dimension?.[3] ?? depth?.[1]) }
      : {}),
    ...(capacityBase != null
      ? { capacityL: capacityBase * (capacity?.[2] ? 1_000 : 1) }
      : {}),
    ...(shape ? { shape } : {}),
    ...(variant?.[1] ? { variantTerms: [variant[1]] } : {}),
  };
}

export function selectRelevantSalesAgentProducts(
  products: CatalogProduct[],
  history: AgentHistory,
  salesState: ConversationSalesState | null = null,
): CatalogProduct[] {
  const lastLeadText = [...history].reverse().find((item) => item.role === "lead")?.text ?? "";
  const normalized = normalizeCatalogText(lastLeadText);
  const decimal = (value: string | undefined): number | null => {
    if (!value) return null;
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const capacityMatch = /(\d+(?:[.,]\d+)?)\s*(mil\s*)?(?:l|litros?)\b/.exec(normalized);
  const currentAttributes = extractCurrentProductAttributes(history);
  const effectiveAttributes = { ...(salesState?.attributes ?? {}), ...currentAttributes };
  const requestedLength = effectiveAttributes.lengthM ?? null;
  const requestedWidth = effectiveAttributes.widthM ?? null;
  const requestedDepth = effectiveAttributes.depthM ?? null;
  const requestedCapacityBase = decimal(capacityMatch?.[1]);
  const requestedCapacity =
    effectiveAttributes.capacityL ??
    (requestedCapacityBase == null
      ? null
      : requestedCapacityBase * (capacityMatch?.[2] ? 1_000 : 1));
  const selectedIds = new Set(
    salesState?.productIds.length
      ? salesState.productIds
      : ([...history].reverse().find((item) => item.role === "agent" && item.productIds?.length)
          ?.productIds ?? salesState?.lastValidProductIds ?? []),
  );
  const selectedProducts = products.filter((product) => selectedIds.has(product.id));
  const ordinalMatch = /\b(?:a\s+)?(?:primeir[ao]|1[ªº])\b/.test(normalized)
    ? 0
    : /\b(?:a\s+)?(?:segund[ao]|2[ªº])\b/.test(normalized)
      ? 1
      : null;
  if (ordinalMatch != null && selectedProducts[ordinalMatch]) {
    return [selectedProducts[ordinalMatch]];
  }
  const usesChosenProductContext =
    selectedIds.size > 0 &&
    (/\b(ele|ela|dele|dela|desse|dessa|esse|essa|este|esta|nesse|nessa)\b/.test(normalized) ||
      ((currentAttributes.variantTerms?.length || currentAttributes.shape) &&
        currentAttributes.lengthM == null));

  let candidates = usesChosenProductContext
    ? products.filter((product) => selectedIds.has(product.id))
    : products;
  let hasStructuredFilter = false;
  if (requestedLength != null) {
    hasStructuredFilter = true;
    candidates = candidates.filter((product) => product.lengthM === requestedLength);
  }
  if (requestedWidth != null) {
    hasStructuredFilter = true;
    candidates = candidates.filter((product) => product.widthM === requestedWidth);
  }
  if (requestedDepth != null) {
    hasStructuredFilter = true;
    candidates = candidates.filter((product) => product.depthM === requestedDepth);
  }
  if (requestedCapacity != null) {
    hasStructuredFilter = true;
    candidates = candidates.filter((product) => product.capacityL === requestedCapacity);
  }

  const explicitModelOrSku =
    /\b(modelo|sku)\b/.test(normalized) && !/\b(?:quadrad[ao]s?|ret[ao]s?)\b/.test(normalized);
  const modelMatches = candidates.filter((product) =>
    [product.model, product.sku]
      .filter((value): value is string => Boolean(value?.trim()))
      .some((value) => normalized.includes(normalizeCatalogText(value))),
  );
  if (modelMatches.length > 0 || explicitModelOrSku) {
    hasStructuredFilter = true;
    candidates = modelMatches;
  }

  const asksRectangularPool = /\b(?:quadrad[ao]s?|ret[ao]s?)\b/.test(normalized);
  const requestedShapeTerm = effectiveAttributes.shape ?? null;
  const shapeMatches = candidates.filter((product) => {
    const shape = normalizeCatalogText(product.shape ?? "");
    if (asksRectangularPool) {
      const category = normalizeCatalogText(product.category ?? "");
      return /piscina/.test(category) && /retangular|\bret[ao]\b|linhas retas/.test(shape);
    }
    return requestedShapeTerm
      ? shape.includes(requestedShapeTerm)
      : Boolean(shape && normalized.includes(shape));
  });
  const asksShape =
    Boolean(requestedShapeTerm) ||
    asksRectangularPool ||
    /\b(retangular|redond[ao]s?|oval|formato)\b/.test(normalized);
  if (shapeMatches.length > 0) {
    hasStructuredFilter = true;
    candidates = shapeMatches;
  } else if (asksShape) {
    hasStructuredFilter = true;
    candidates = [];
  }

  const requestedVariantTerms = effectiveAttributes.variantTerms ?? [];
  const variantMatches = candidates.filter((product) => {
    const productTerms = collectVariantTerms(product.variants ?? []);
    return requestedVariantTerms.length > 0
      ? requestedVariantTerms.some((requested) =>
          productTerms.some((value) => value.includes(requested) || requested.includes(value)),
        )
      : productTerms.some((value) => normalized.includes(value));
  });
  if (
    variantMatches.length > 0 ||
    requestedVariantTerms.length > 0 ||
    /\b(cor|variante)\b/.test(normalized)
  ) {
    hasStructuredFilter = true;
    candidates = variantMatches;
  }

  if (hasStructuredFilter) return candidates;
  if (selectedIds.size > 0) {
    const selected = products.filter((product) => selectedIds.has(product.id));
    if (selected.length > 0) return selected;
  }

  const intentConcepts = [
    /\bfibr/,
    /\bvinil/,
    /\bspa\b/,
    /\bbanheir/,
    /\baquec/,
    /\bacessor/,
    /\btratament/,
  ].filter((concept) => concept.test(normalized));
  if (intentConcepts.length === 0) {
    return rankRelevantProducts(products, history).slice(0, SALES_AGENT_MAX_OPTIONS);
  }
  return rankRelevantProducts(products.filter((product) => {
    const haystack = normalizeCatalogText(
      [
        product.name,
        product.category,
        product.description,
        product.notes,
        product.specifications ? JSON.stringify(product.specifications) : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
    return intentConcepts.some((concept) => concept.test(haystack));
  }), history).slice(0, SALES_AGENT_MAX_OPTIONS);
}

function mapLearning(learning: Awaited<ReturnType<typeof listLearningCandidates>>[number]) {
  return {
    id: learning.id,
    category: learning.category,
    title: learning.title,
    description: learning.description,
    rule: learning.rule_structured,
    productRef: learning.product_ref,
    positiveExample: learning.positive_example,
    negativeExample: learning.negative_example,
    priority: learning.priority,
    confidence: learning.confidence,
  };
}

function selectDiverseLearnings(
  learnings: Awaited<ReturnType<typeof listLearningCandidates>>,
  maxSelected: number,
) {
  const selected: typeof learnings = [];
  const categories = new Set<string>();
  for (const learning of learnings) {
    if (selected.length >= maxSelected) break;
    if (!categories.has(learning.category)) {
      selected.push(learning);
      categories.add(learning.category);
    }
  }
  for (const learning of learnings) {
    if (selected.length >= maxSelected) break;
    if (!selected.some((item) => item.id === learning.id)) selected.push(learning);
  }
  return selected;
}

export async function loadRelevantSalesAgentLearnings(
  companyId: string,
  history: AgentHistory,
): Promise<SalesAgentGrounding["approvedCoachLearnings"]> {
  const candidates = await listLearningCandidates(supabaseAdmin, companyId, 30);
  let lastLeadIndex = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].role === "lead") {
      lastLeadIndex = index;
      break;
    }
  }
  const currentMessage = lastLeadIndex >= 0 ? history[lastLeadIndex].text : null;
  const recentMessages = history.filter((_, index) => index !== lastLeadIndex).slice(-6);
  const result = retrieveLearnings({
    companyId,
    currentMessage,
    recentMessages,
    candidates,
    maxSelected: 5,
  });
  return selectDiverseLearnings(result.selected, SALES_AGENT_MAX_OPTIONS).map(mapLearning);
}

export async function loadSalesAgentGrounding(companyId: string): Promise<SalesAgentGrounding> {
  const safeSource = async <T>(
    request: PromiseLike<{ data: T | null; error?: unknown }>,
    fallback: T,
  ): Promise<T> => {
    try {
      const result = await request;
      return result.error ? fallback : (result.data ?? fallback);
    } catch {
      return fallback;
    }
  };

  const [products, knowledge, commercial] = await Promise.all([
    safeSource(
      supabaseAdmin
        .from("products")
        .select(
          "id, name, model, sku, category, description, length_m, width_m, depth_m, capacity_l, shape, specifications, included_items, variants, price, promo_price, images, notes",
        )
        .eq("company_id", companyId)
        .eq("active", true)
        .order("name", { ascending: true }),
      [],
    ),
    safeSource(
      supabaseAdmin
        .from("ai_knowledge_proposals")
        .select("question, answer, type")
        .eq("company_id", companyId)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(20),
      [],
    ),
    safeSource<{
      commercial_terms: string | null;
      payment_policy: string | null;
      installation_policy: string | null;
      next_load_forecast: string | null;
      visit_policy: string | null;
      heating_policy: string | null;
      shipping_policy: string | null;
      included_items_policy: string | null;
    } | null>(
      supabaseAdmin
        .from("marketing_knowledge_base")
        .select(
          "commercial_terms, payment_policy, installation_policy, next_load_forecast, visit_policy, heating_policy, shipping_policy, included_items_policy",
        )
        .eq("company_id", companyId)
        .maybeSingle(),
      null,
    ),
  ]);

  return {
    catalog: products.map((product) => ({
      id: product.id,
      name: product.name,
      model: product.model,
      sku: product.sku,
      category: product.category,
      description: product.description,
      lengthM: product.length_m as number | null,
      widthM: product.width_m as number | null,
      depthM: product.depth_m as number | null,
      capacityL: product.capacity_l as number | null,
      shape: product.shape,
      specifications:
        product.specifications &&
        typeof product.specifications === "object" &&
        !Array.isArray(product.specifications)
          ? product.specifications
          : {},
      includedItems: Array.isArray(product.included_items)
        ? product.included_items.filter((item): item is string => typeof item === "string")
        : [],
      variants: Array.isArray(product.variants)
        ? product.variants.filter(
            (item) => Boolean(item) && typeof item === "object" && !Array.isArray(item),
          )
        : [],
      price: product.price as number | null,
      promoPrice: product.promo_price as number | null,
      images: Array.isArray(product.images)
        ? (product.images as unknown[]).filter(
            (image): image is string => typeof image === "string",
          )
        : [],
      notes: product.notes,
    })),
    faqKnowledge: knowledge,
    commercialRules: {
      paymentMethods: null,
      commercialTerms: commercial?.commercial_terms ?? null,
      paymentPolicy: commercial?.payment_policy?.trim() || null,
      installationPolicy: commercial?.installation_policy?.trim() || null,
      nextLoadForecast: commercial?.next_load_forecast?.trim() || null,
      visitPolicy: commercial?.visit_policy?.trim() || null,
      heatingPolicy: commercial?.heating_policy?.trim() || null,
      shippingPolicy: commercial?.shipping_policy?.trim() || null,
      includedItemsPolicy: commercial?.included_items_policy?.trim() || null,
    },
    approvedCoachLearnings: [],
  };
}
