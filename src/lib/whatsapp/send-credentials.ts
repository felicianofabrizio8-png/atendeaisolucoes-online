// ============================================================================
// Credenciais de envio WhatsApp Cloud API por empresa.
//
// A fonte de verdade é a integração ativa da própria empresa. As variáveis de
// ambiente globais (WHATSAPP_ACCESS_TOKEN / WHATSAPP_API_KEY /
// WHATSAPP_PHONE_NUMBER_ID) só podem completar o token de uma integração cujo
// número é exatamente o número configurado no ambiente. Nunca servem de
// substituto para empresa sem integração ou com outro número — isso enviaria
// mensagens de um tenant pelo número de outro.
// ============================================================================

export interface WhatsappIntegrationCredentials {
  access_token?: string | null;
  external_account_id?: string | null;
}

export type WhatsappSendCredentials =
  | {
      ok: true;
      accessToken: string;
      phoneNumberId: string;
      source: "integration" | "env_same_number";
    }
  | { ok: false; reason: "no_integration" | "no_phone_number_id" | "no_access_token" };

export function resolveWhatsappSendCredentials(
  integration: WhatsappIntegrationCredentials | null | undefined,
  env: Record<string, string | undefined> = process.env,
): WhatsappSendCredentials {
  if (!integration) return { ok: false, reason: "no_integration" };
  const phoneNumberId = integration.external_account_id?.trim() ?? "";
  if (!phoneNumberId) return { ok: false, reason: "no_phone_number_id" };
  const own = integration.access_token?.trim() ?? "";
  if (own) return { ok: true, accessToken: own, phoneNumberId, source: "integration" };

  const envPhone = env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "";
  const envToken = (env.WHATSAPP_ACCESS_TOKEN || env.WHATSAPP_API_KEY || "").trim();
  if (envToken && envPhone && envPhone === phoneNumberId) {
    return { ok: true, accessToken: envToken, phoneNumberId, source: "env_same_number" };
  }
  return { ok: false, reason: "no_access_token" };
}
