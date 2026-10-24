/**
 * The Bruna text adapter is an opt-in rollout switch. An absent, malformed, or
 * differently named value is deliberately disabled so existing tenants keep
 * the legacy sender.
 */
export const BRUNA_WHATSAPP_TEXT_ADAPTER_ENV = "BRUNA_WHATSAPP_TEXT_ADAPTER";

export function isBrunaWhatsappTextAdapterEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[BRUNA_WHATSAPP_TEXT_ADAPTER_ENV]?.trim().toLowerCase() === "enabled";
}
