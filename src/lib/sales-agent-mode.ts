export const SALES_AGENT_MODES = ["silent", "assisted", "automatic"] as const;

export type SalesAgentMode = (typeof SALES_AGENT_MODES)[number];

export interface SalesAgentModeSettings {
  sales_agent_v2_enabled?: boolean | null;
  sales_agent_v2_mode?: string | null;
}

/** Resolve o modo opt-in sem alterar o fluxo legado. */
export function resolveSalesAgentMode(settings: SalesAgentModeSettings): SalesAgentMode | null {
  if (settings.sales_agent_v2_enabled !== true) return null;
  return SALES_AGENT_MODES.includes(settings.sales_agent_v2_mode as SalesAgentMode)
    ? (settings.sales_agent_v2_mode as SalesAgentMode)
    : "assisted";
}

export function canSalesAgentSend(mode: SalesAgentMode | null): boolean {
  return mode === null || mode === "automatic";
}

export function salesAgentModeReason(
  mode: SalesAgentMode,
): "v2_silent" | "v2_assisted_approval_required" {
  return mode === "silent" ? "v2_silent" : "v2_assisted_approval_required";
}
