// ============================================================================
// followup/integration.ts
// Responsabilidade: obter status da integração WhatsApp de uma empresa,
// inclusive amostras de eventos não mapeados dos últimos 7 dias.
// Somente leitura.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { WhatsappIntegrationStatus } from "./types";

export async function getWhatsappIntegrationStatus(
  companyId: string,
): Promise<WhatsappIntegrationStatus> {
  const out: WhatsappIntegrationStatus = {
    connected: false,
    hasUnmapped: false,
    unmappedCount: 0,
    displayName: null,
    externalAccountId: null,
    tokenExpiresAt: null,
    lastError: null,
    unmappedSamples: [],
  };
  try {
    const { data: integ } = await supabaseAdmin
      .from("integrations")
      .select(
        "display_name, external_account_id, active, last_error, token_expires_at, has_access_token",
      )
      .eq("company_id", companyId)
      .eq("channel", "whatsapp")
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (integ && integ.has_access_token) {
      out.connected = true;
      out.displayName = integ.display_name ?? null;
      out.externalAccountId = integ.external_account_id ?? null;
      out.tokenExpiresAt = integ.token_expires_at ?? null;
      out.lastError = integ.last_error ?? null;
    }
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data: unmapped } = await supabaseAdmin
      .from("whatsapp_unmapped_events")
      .select("phone_number_id, display_phone_number, contact_name, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20);
    if (unmapped && unmapped.length > 0) {
      out.hasUnmapped = true;
      out.unmappedCount = unmapped.length;
      out.unmappedSamples = unmapped.slice(0, 5).map((u) => ({
        phone_number_id: u.phone_number_id,
        display_phone_number: u.display_phone_number,
        contact_name: u.contact_name,
        created_at: u.created_at,
      }));
    }
  } catch (e) {
    out.lastError = e instanceof Error ? e.message : "erro ao consultar integração";
  }
  return out;
}
