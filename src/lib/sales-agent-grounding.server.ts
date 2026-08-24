import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { listLearningCandidates } from "./coach-learnings/coach-learnings.repository";
import { retrieveLearnings } from "./coach-learnings/retriever";
import type { SalesAgentGrounding } from "./sales-agent-core";
import { productMatchesMeasure } from "./product-measure-filter";

export type AgentHistory = Array<{
  role: "lead" | "agent" | "system";
  text: string;
  productIds?: string[];
}>;
type CatalogProduct = SalesAgentGrounding["catalog"][number];

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

export function selectRelevantSalesAgentProducts(
  products: CatalogProduct[],
  history: AgentHistory,
): CatalogProduct[] {
  const lastLeadText = [...history].reverse().find((item) => item.role === "lead")?.text ?? "";
  const normalized = normalizeCatalogText(lastLeadText);
  const decimal = (value: string | undefined): number | null => {
    if (!value) return null;
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const dimensionMatch =
    /(?:^|\D)(\d{1,2}(?:[.,]\d+)?)\s*[x×]\s*(\d{1,2}(?:[.,]\d+)?)(?:\s*[x×]\s*(\d{1,2}(?:[.,]\d+)?))?/.exec(
      normalized,
    );
  const explicitLengthMatch =
    /comprimento\s*(?:de)?\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:m|metros?)?\b/.exec(normalized);
  const genericLengthMatch = /(?:^|\D)(\d{1,2}(?:[.,]\d+)?)\s*(?:m|metros?)\b/.exec(normalized);
  const widthMatch = /largura\s*(?:de)?\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:m|metros?)?\b/.exec(
    normalized,
  );
  const depthMatch = /profundidade\s*(?:de)?\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:m|metros?)?\b/.exec(
    normalized,
  );
  const capacityMatch = /(\d+(?:[.,]\d+)?)\s*(mil\s*)?(?:l|litros?)\b/.exec(normalized);
  const requestedLength = decimal(
    dimensionMatch?.[1] ??
      explicitLengthMatch?.[1] ??
      (!widthMatch && !depthMatch ? genericLengthMatch?.[1] : undefined),
  );
  const requestedWidth = decimal(dimensionMatch?.[2] ?? widthMatch?.[1]);
  const requestedDepth = decimal(dimensionMatch?.[3] ?? depthMatch?.[1]);
  const requestedCapacityBase = decimal(capacityMatch?.[1]);
  const requestedCapacity =
    requestedCapacityBase == null ? null : requestedCapacityBase * (capacityMatch?.[2] ? 1_000 : 1);
  const selectedIds = new Set(
    [...history].reverse().find((item) => item.role === "agent" && item.productIds?.length)
      ?.productIds ?? [],
  );
  const usesChosenProductContext =
    selectedIds.size > 0 &&
    /\b(ele|ela|dele|dela|desse|dessa|esse|essa|este|esta|nesse|nessa)\b/.test(normalized);

  let candidates = usesChosenProductContext
    ? products.filter((product) => selectedIds.has(product.id))
    : products;
  let hasStructuredFilter = false;
  if (requestedLength != null) {
    hasStructuredFilter = true;
    candidates = candidates.filter((product) =>
      product.lengthM != null
        ? product.lengthM === requestedLength
        : productMatchesMeasure(
            { name: product.name, description: product.description },
            requestedLength,
          ),
    );
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

  const explicitModelOrSku = /\b(modelo|sku)\b/.test(normalized);
  const modelMatches = candidates.filter((product) =>
    [product.model, product.sku]
      .filter((value): value is string => Boolean(value?.trim()))
      .some((value) => normalized.includes(normalizeCatalogText(value))),
  );
  if (modelMatches.length > 0 || explicitModelOrSku) {
    hasStructuredFilter = true;
    candidates = modelMatches;
  }

  const asksSquare = /\bquadrad[ao]\b/.test(normalized);
  const requestedShapeTerm = asksSquare
    ? "quadrad"
    : (["retangular", "redond", "oval"].find((term) => normalized.includes(term)) ?? null);
  const shapeMatches = candidates.filter((product) => {
    const shape = normalizeCatalogText(product.shape ?? "");
    return requestedShapeTerm
      ? shape.includes(requestedShapeTerm)
      : Boolean(shape && normalized.includes(shape));
  });
  const asksShape = asksSquare || /\b(retangular|redond[ao]|oval|formato)\b/.test(normalized);
  if (shapeMatches.length > 0) {
    hasStructuredFilter = true;
    candidates = shapeMatches;
  } else if (asksSquare) {
    hasStructuredFilter = true;
    candidates = candidates.filter((product) => {
      const category = normalizeCatalogText(product.category ?? "");
      const shape = normalizeCatalogText(product.shape ?? "");
      return /piscina/.test(category) && /retangular|reto|linhas retas/.test(shape);
    });
  } else if (asksShape) {
    hasStructuredFilter = true;
    candidates = [];
  }

  const variantMatches = candidates.filter((product) => {
    return collectVariantTerms(product.variants ?? []).some((value) => normalized.includes(value));
  });
  if (variantMatches.length > 0 || /\b(cor|variante)\b/.test(normalized)) {
    hasStructuredFilter = true;
    candidates = variantMatches;
  }

  if (hasStructuredFilter) return candidates;
  if (selectedIds.size > 0) {
    const selected = products.filter((product) => selectedIds.has(product.id));
    if (selected.length > 0) return selected;
  }

  const intentTerms = [
    "fibra",
    "vinil",
    "spa",
    "banheira",
    "aquecedor",
    "aquecimento",
    "acessorio",
    "tratamento",
  ].filter((term) => normalized.includes(term));
  if (intentTerms.length === 0) return products;
  return products.filter((product) => {
    const haystack = normalizeCatalogText(
      [product.name, product.category, product.description, product.notes]
        .filter(Boolean)
        .join(" "),
    );
    return intentTerms.some((term) => haystack.includes(term));
  });
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

export async function loadRelevantSalesAgentLearnings(
  companyId: string,
  history: AgentHistory,
): Promise<SalesAgentGrounding["approvedCoachLearnings"]> {
  const candidates = await listLearningCandidates(supabaseAdmin, companyId, 50);
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
  return result.selected.map(mapLearning);
}

export async function loadSalesAgentGrounding(companyId: string): Promise<SalesAgentGrounding> {
  const [{ data: products }, { data: knowledge }, { data: commercial }] = await Promise.all([
    supabaseAdmin
      .from("products")
      .select(
        "id, name, model, sku, category, description, length_m, width_m, depth_m, capacity_l, shape, specifications, included_items, variants, price, promo_price, images, notes",
      )
      .eq("company_id", companyId)
      .eq("active", true)
      .order("name", { ascending: true }),
    supabaseAdmin
      .from("ai_knowledge_proposals")
      .select("question, answer, type")
      .eq("company_id", companyId)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(20),
    supabaseAdmin
      .from("marketing_knowledge_base")
      .select("commercial_terms")
      .eq("company_id", companyId)
      .maybeSingle(),
  ]);

  return {
    catalog: (products ?? []).map((product) => ({
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
    faqKnowledge: knowledge ?? [],
    commercialRules: {
      paymentMethods: null,
      commercialTerms: commercial?.commercial_terms ?? null,
    },
    approvedCoachLearnings: [],
  };
}
