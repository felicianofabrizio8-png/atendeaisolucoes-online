import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  EMPTY_CONVERSATION_SALES_STATE,
  type ConversationSalesScopeType,
  type ConversationSalesState,
} from "./conversation-sales-state";

export interface ConversationSalesStateScope {
  companyId: string;
  scopeType: ConversationSalesScopeType;
  scopeId: string;
}

export async function loadConversationSalesState(
  scope: ConversationSalesStateScope,
): Promise<ConversationSalesState> {
  const { data, error } = await supabaseAdmin
    .from("conversation_sales_states" as never)
    .select("product_ids, attributes, intent, last_valid_product_ids")
    .eq("company_id", scope.companyId)
    .eq("scope_type", scope.scopeType)
    .eq("scope_id", scope.scopeId)
    .maybeSingle();
  if (error || !data) return EMPTY_CONVERSATION_SALES_STATE;
  const row = data as unknown as {
    product_ids?: string[];
    attributes?: ConversationSalesState["attributes"];
    intent?: string | null;
    last_valid_product_ids?: string[];
  };
  return {
    productIds: Array.isArray(row.product_ids) ? row.product_ids : [],
    attributes:
      row.attributes && typeof row.attributes === "object" && !Array.isArray(row.attributes)
        ? row.attributes
        : {},
    intent: typeof row.intent === "string" ? row.intent : null,
    lastValidProductIds: Array.isArray(row.last_valid_product_ids)
      ? row.last_valid_product_ids
      : [],
  };
}

export async function saveConversationSalesState(
  scope: ConversationSalesStateScope,
  state: ConversationSalesState,
): Promise<void> {
  const { error } = await supabaseAdmin.from("conversation_sales_states" as never).upsert(
    {
      company_id: scope.companyId,
      scope_type: scope.scopeType,
      scope_id: scope.scopeId,
      product_ids: state.productIds,
      attributes: state.attributes,
      intent: state.intent,
      last_valid_product_ids: state.lastValidProductIds,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "company_id,scope_type,scope_id" },
  );
  if (error) throw new Error("conversation_sales_state_save_failed");
}
