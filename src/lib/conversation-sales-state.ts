import type {
  SalesAgentConfirmation,
  SalesAgentProductReferenceKind,
  SalesAgentSubject,
} from "./sales-agent-interpretation";

export type ConversationSalesScopeType = "training_session" | "whatsapp_conversation";

export interface ConversationProductAttributes {
  lengthM?: number;
  widthM?: number;
  depthM?: number;
  capacityL?: number;
  spaceLengthM?: number;
  spaceWidthM?: number;
  sizeComparison?: "larger" | "smaller";
  shape?: string;
  variantTerms?: string[];
}

export type ConversationCatalogQueryStatus =
  | "matches"
  | "no_match"
  | "ambiguous"
  | "empty_catalog"
  | "query_error";

export interface LastCatalogQuery {
  status: ConversationCatalogQueryStatus;
  criteria: ConversationProductAttributes;
  referencedProductIds: string[];
  subject?: SalesAgentSubject;
  productReferenceKind?: SalesAgentProductReferenceKind;
  confirmation?: SalesAgentConfirmation;
  confidence?: number;
}

export interface ConversationSalesState {
  productIds: string[];
  attributes: ConversationProductAttributes;
  intent: string | null;
  lastValidProductIds: string[];
  lastCatalogQuery?: LastCatalogQuery | null;
}

export const EMPTY_CONVERSATION_SALES_STATE: ConversationSalesState = {
  productIds: [],
  attributes: {},
  intent: null,
  lastValidProductIds: [],
  lastCatalogQuery: null,
};

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

export function mergeConversationSalesState(
  previous: ConversationSalesState | null,
  update: {
    attributes?: ConversationProductAttributes;
    intent?: string | null;
    candidateProductIds?: string[];
    selectedProductIds?: string[];
    lastCatalogQuery?: LastCatalogQuery | null;
  },
): ConversationSalesState {
  const base = sanitizeConversationSalesState(previous ?? EMPTY_CONVERSATION_SALES_STATE);
  const candidates = uniqueIds(update.candidateProductIds ?? []);
  const selected = update.selectedProductIds
    ? uniqueIds(update.selectedProductIds)
    : base.productIds;
  const attributes = sanitizeConversationProductAttributes(update.attributes);
  const lastCatalogQuery = update.lastCatalogQuery === undefined
    ? base.lastCatalogQuery
    : sanitizeLastCatalogQuery(update.lastCatalogQuery);
  return sanitizeConversationSalesState({
    productIds: selected,
    attributes: { ...base.attributes, ...attributes },
    intent: update.intent ?? base.intent,
    lastValidProductIds: candidates.length > 0 ? candidates : base.lastValidProductIds,
    lastCatalogQuery,
  });
}

const CONVERSATION_ATTRIBUTE_KEYS = new Set([
  "lengthM",
  "widthM",
  "depthM",
  "capacityL",
  "spaceLengthM",
  "spaceWidthM",
  "sizeComparison",
  "shape",
  "variantTerms",
]);

const LAST_CATALOG_QUERY_STATUSES = new Set<ConversationCatalogQueryStatus>([
  "matches",
  "no_match",
  "ambiguous",
  "empty_catalog",
  "query_error",
]);

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function sanitizeConversationProductAttributes(
  value: unknown,
): ConversationProductAttributes {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const output: ConversationProductAttributes = {};
  for (const key of CONVERSATION_ATTRIBUTE_KEYS) {
    if (!(key in input)) continue;
    if (["lengthM", "widthM", "depthM", "capacityL", "spaceLengthM", "spaceWidthM"].includes(key)) {
      const numberValue = finiteNonNegative(input[key]);
      if (numberValue !== undefined) output[key as keyof ConversationProductAttributes] = numberValue as never;
    } else if (key === "sizeComparison" && (input[key] === "larger" || input[key] === "smaller")) {
      output.sizeComparison = input[key];
    } else if (key === "shape" && typeof input[key] === "string" && input[key].length <= 80) {
      output.shape = input[key];
    } else if (key === "variantTerms" && Array.isArray(input[key])) {
      output.variantTerms = input[key]
        .filter((item): item is string => typeof item === "string" && item.length <= 80)
        .slice(0, 10);
    }
  }
  return output;
}

export function sanitizeLastCatalogQuery(value: unknown): LastCatalogQuery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const status = input.status;
  if (typeof status !== "string" || !LAST_CATALOG_QUERY_STATUSES.has(status as ConversationCatalogQueryStatus)) {
    return null;
  }
  const referencedProductIds = Array.isArray(input.referencedProductIds)
    ? [...new Set(input.referencedProductIds.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : [];
  const subjects = new Set<SalesAgentSubject>(["product", "price", "dimensions", "variant", "commercial", "installation", "unknown"]);
  const referenceKinds = new Set<SalesAgentProductReferenceKind>(["explicit", "pronoun", "ordinal", "continuation", "none"]);
  const confirmations = new Set<SalesAgentConfirmation>(["affirmative", "negative", "none"]);
  const subject = subjects.has(input.subject as SalesAgentSubject) ? input.subject as SalesAgentSubject : undefined;
  const productReferenceKind = referenceKinds.has(input.productReferenceKind as SalesAgentProductReferenceKind)
    ? input.productReferenceKind as SalesAgentProductReferenceKind
    : undefined;
  const confirmation = confirmations.has(input.confirmation as SalesAgentConfirmation)
    ? input.confirmation as SalesAgentConfirmation
    : undefined;
  const confidence = typeof input.confidence === "number" && Number.isFinite(input.confidence)
    ? Math.max(0, Math.min(1, input.confidence))
    : undefined;
  return {
    status: status as ConversationCatalogQueryStatus,
    criteria: sanitizeConversationProductAttributes(input.criteria),
    referencedProductIds,
    ...(subject ? { subject } : {}),
    ...(productReferenceKind ? { productReferenceKind } : {}),
    ...(confirmation ? { confirmation } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

export function sanitizeConversationSalesState(state: ConversationSalesState): ConversationSalesState {
  return {
    productIds: [...new Set(state.productIds.filter((id) => typeof id === "string" && id.length > 0))],
    attributes: sanitizeConversationProductAttributes(state.attributes),
    intent: typeof state.intent === "string" ? state.intent : null,
    lastValidProductIds: [...new Set(state.lastValidProductIds.filter((id) => typeof id === "string" && id.length > 0))],
    lastCatalogQuery: sanitizeLastCatalogQuery(state.lastCatalogQuery),
  };
}

export function revalidateConversationSalesState(
  state: ConversationSalesState,
  activeProductIds: Iterable<string>,
): ConversationSalesState {
  state = sanitizeConversationSalesState(state);
  const active = new Set(activeProductIds);
  return sanitizeConversationSalesState({
    ...state,
    productIds: state.productIds.filter((id) => active.has(id)),
    lastValidProductIds: state.lastValidProductIds.filter((id) => active.has(id)),
    lastCatalogQuery: state.lastCatalogQuery
      ? {
          ...state.lastCatalogQuery,
          referencedProductIds: state.lastCatalogQuery.referencedProductIds.filter((id) => active.has(id)),
        }
      : null,
  });
}
