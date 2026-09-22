import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  sanitizeConversationProductAttributes,
  sanitizeLastCatalogQuery,
  sanitizeConversationSalesState,
  type ConversationSalesScopeType,
  type ConversationSalesState,
  type LastCatalogQuery,
} from "./conversation-sales-state";

export interface ConversationSalesStateScope {
  companyId: string;
  scopeType: ConversationSalesScopeType;
  scopeId: string;
}

export type ConversationSalesStateLoadResult =
  | { status: "found"; state: ConversationSalesState }
  | { status: "missing"; state: null }
  | { status: "error"; state: null; error: unknown };

export type ConversationSalesStateValidationResult =
  | { status: "validated"; state: ConversationSalesState }
  | { status: "error"; state: null; error: unknown };

export async function revalidateConversationSalesState(
  scope: ConversationSalesStateScope,
  state: ConversationSalesState,
): Promise<ConversationSalesStateValidationResult> {
  state = sanitizeConversationSalesState(state);
  const ids = [...new Set([
    ...state.productIds,
    ...state.lastValidProductIds,
    ...(state.lastCatalogQuery?.referencedProductIds ?? []),
  ].filter(Boolean))];
  if (ids.length === 0) return { status: "validated", state };
  const { data, error } = await supabaseAdmin
    .from("products")
    .select("id")
    .eq("company_id", scope.companyId)
    .eq("active", true)
    .in("id", ids);
  if (error || !Array.isArray(data)) {
    return { status: "error", state: null, error: error ?? new Error("active_product_validation_failed") };
  }
  const activeIds = new Set(
    data.filter((row): row is { id: string } => Boolean(row) && typeof row.id === "string").map((row) => row.id),
  );
  return {
    status: "validated",
    state: {
      ...state,
      productIds: state.productIds.filter((id) => activeIds.has(id)),
      lastValidProductIds: state.lastValidProductIds.filter((id) => activeIds.has(id)),
      lastCatalogQuery: state.lastCatalogQuery
        ? {
            ...state.lastCatalogQuery,
            referencedProductIds: state.lastCatalogQuery.referencedProductIds.filter((id) => activeIds.has(id)),
          }
        : null,
    },
  };
}

export async function loadConversationSalesState(
  scope: ConversationSalesStateScope,
): Promise<ConversationSalesStateLoadResult> {
  const { data, error } = await supabaseAdmin
    .from("conversation_sales_states" as never)
    .select("product_ids, attributes, intent, last_valid_product_ids, last_catalog_query")
    .eq("company_id", scope.companyId)
    .eq("scope_type", scope.scopeType)
    .eq("scope_id", scope.scopeId)
    .maybeSingle();
  if (error) return { status: "error", state: null, error };
  if (!data) return { status: "missing", state: null };
  const row = data as unknown as {
    product_ids?: string[];
    attributes?: ConversationSalesState["attributes"];
    intent?: string | null;
    last_valid_product_ids?: string[];
    last_catalog_query?: LastCatalogQuery | null;
  };
  const state: ConversationSalesState = {
    productIds: Array.isArray(row.product_ids) ? row.product_ids : [],
    attributes: sanitizeConversationProductAttributes(row.attributes),
    intent: typeof row.intent === "string" ? row.intent : null,
    lastValidProductIds: Array.isArray(row.last_valid_product_ids)
      ? row.last_valid_product_ids
      : [],
    lastCatalogQuery: sanitizeLastCatalogQuery(row.last_catalog_query),
  };
  return { status: "found", state };
}

export async function saveConversationSalesState(
  scope: ConversationSalesStateScope,
  state: ConversationSalesState,
): Promise<void> {
  state = sanitizeConversationSalesState(state);
  const validated = await revalidateConversationSalesState(scope, state);
  if (validated.status === "error") throw new Error("conversation_sales_state_validation_failed");
  state = validated.state;
  const { error } = await supabaseAdmin.from("conversation_sales_states" as never).upsert(
    {
      company_id: scope.companyId,
      scope_type: scope.scopeType,
      scope_id: scope.scopeId,
      product_ids: state.productIds,
      attributes: state.attributes,
      intent: state.intent,
      last_valid_product_ids: state.lastValidProductIds,
      last_catalog_query: state.lastCatalogQuery,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "company_id,scope_type,scope_id" },
  );
  if (error) throw new Error("conversation_sales_state_save_failed");
}
