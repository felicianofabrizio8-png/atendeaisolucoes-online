export const SALES_AGENT_MODES = ["silent", "assisted", "automatic"] as const;

export type SalesAgentMode = (typeof SALES_AGENT_MODES)[number];

export interface SalesAgentModeSettings {
  sales_agent_v2_enabled?: boolean | null;
  sales_agent_v2_mode?: string | null;
  /** "conversation" quando o automático foi ligado pelo atendente só naquela conversa. */
  sales_agent_v2_mode_source?: string | null;
}

/** Resolve o modo opt-in sem alterar o fluxo legado. */
export function resolveSalesAgentMode(settings: SalesAgentModeSettings): SalesAgentMode | null {
  if (settings.sales_agent_v2_enabled !== true) return null;
  return SALES_AGENT_MODES.includes(settings.sales_agent_v2_mode as SalesAgentMode)
    ? (settings.sales_agent_v2_mode as SalesAgentMode)
    : "assisted";
}

/**
 * A empresa usa a Vendedora 2.0 no atendimento (assistido ou automático)? Decide, por
 * empresa, qual painel de IA o atendente vê. Em `silent` ela só é avaliada, sem aparecer
 * para o atendente, então o painel anterior continua valendo.
 */
export function isSalesAgentServingAttendants(settings: SalesAgentModeSettings | null | undefined): boolean {
  if (!settings) return false;
  const mode = resolveSalesAgentMode(settings);
  return mode === "assisted" || mode === "automatic";
}

export function canSalesAgentSend(mode: SalesAgentMode | null): boolean {
  return mode === null || mode === "automatic";
}

export function salesAgentModeReason(
  mode: SalesAgentMode,
): "v2_silent" | "v2_assisted_approval_required" {
  return mode === "silent" ? "v2_silent" : "v2_assisted_approval_required";
}

/**
 * Automático por conversa: a empresa continua em `assisted`, e o atendente liga a resposta
 * automática só na conversa que ele escolheu. Fora de `assisted` a marcação não muda nada
 * (silent continua só avaliando; automatic da empresa já responde).
 */
export function withConversationAutoReply<T extends SalesAgentModeSettings>(settings: T, enabled: boolean): T {
  if (!enabled || resolveSalesAgentMode(settings) !== "assisted") return settings;
  return { ...settings, sales_agent_v2_mode: "automatic", sales_agent_v2_mode_source: "conversation" };
}

export function isConversationAutoReply(settings: SalesAgentModeSettings): boolean {
  return settings.sales_agent_v2_mode_source === "conversation" && resolveSalesAgentMode(settings) === "automatic";
}
