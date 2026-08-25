export type ConversationSalesScopeType = "training_session" | "whatsapp_conversation";

export interface ConversationProductAttributes {
  lengthM?: number;
  widthM?: number;
  depthM?: number;
  capacityL?: number;
  shape?: string;
  variantTerms?: string[];
}

export interface ConversationSalesState {
  productIds: string[];
  attributes: ConversationProductAttributes;
  intent: string | null;
  lastValidProductIds: string[];
}

export const EMPTY_CONVERSATION_SALES_STATE: ConversationSalesState = {
  productIds: [],
  attributes: {},
  intent: null,
  lastValidProductIds: [],
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
  },
): ConversationSalesState {
  const base = previous ?? EMPTY_CONVERSATION_SALES_STATE;
  const candidates = uniqueIds(update.candidateProductIds ?? []);
  const selected = update.selectedProductIds
    ? uniqueIds(update.selectedProductIds)
    : base.productIds;
  return {
    productIds: selected,
    attributes: { ...base.attributes, ...(update.attributes ?? {}) },
    intent: update.intent ?? base.intent,
    lastValidProductIds: candidates.length > 0 ? candidates : base.lastValidProductIds,
  };
}
