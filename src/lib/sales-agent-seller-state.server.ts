import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sanitizeSellerState, type SellerState } from "./sales-agent-seller-state";

const SCOPE_TYPE = "whatsapp_conversation";

/**
 * Estado da Vendedora 2.0 da conversa. Qualquer falha (inclusive a coluna ainda não existir
 * no banco) devolve null: o turno segue sem memória, como era antes.
 */
export async function loadSellerState(companyId: string, conversationId: string): Promise<SellerState | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("conversation_sales_states" as never)
      .select("seller_state")
      .eq("company_id", companyId)
      .eq("scope_type", SCOPE_TYPE)
      .eq("scope_id", conversationId)
      .maybeSingle();
    if (error || !data) return null;
    return sanitizeSellerState((data as { seller_state?: unknown }).seller_state);
  } catch {
    return null;
  }
}

/** Guarda o estado devolvido pela Vendedora. Falha aqui nunca derruba o turno. */
export async function saveSellerState(companyId: string, conversationId: string, state: unknown): Promise<void> {
  const clean = sanitizeSellerState(state);
  if (!clean) return;
  try {
    const { error } = await supabaseAdmin.from("conversation_sales_states" as never).upsert(
      {
        company_id: companyId,
        scope_type: SCOPE_TYPE,
        scope_id: conversationId,
        seller_state: clean,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "company_id,scope_type,scope_id" },
    );
    if (error) console.warn("[SALES_AGENT_SELLER_STATE_SAVE_FAILED]");
  } catch {
    console.warn("[SALES_AGENT_SELLER_STATE_SAVE_FAILED]");
  }
}
