// Tipos compartilhados do módulo Environment.
// Puros; não importam runtime, Supabase ou fetch.

export type EnvironmentName = "production" | "staging";

/** Resultado do lookup de ambiente para uma empresa. */
export type EnvironmentLookup =
  | { ok: true; environment: EnvironmentName; cachedAt: number }
  | { ok: false; reason: "not_found" | "lookup_error"; error?: string };

/** Ação externa a ser verificada pelo guard. */
export interface OutboundAction {
  companyId: string;
  userId?: string | null;
  agentId?: string | null;
  action: string; // ex: "whatsapp.send.text", "meta.campaign.publish"
  targetUrl?: string | null;
  method?: "GET" | "POST" | "DELETE" | "PUT" | "PATCH" | null;
  payload?: unknown; // será sanitizado
}

/** Decisão do EnvironmentGuard. */
export type GuardDecision =
  | { proceed: true; environment: EnvironmentName | "legacy" }
  | {
      proceed: false;
      environment: "staging" | "unknown";
      simulationId: string | null;
      reason: "staging_tenant" | "lookup_failed" | "logger_failed";
      logError?: boolean;
    };

/** Registro persistido em environment_simulations (payload já sanitizado). */
export interface SimulationRecord {
  companyId: string;
  userId?: string | null;
  agentId?: string | null;
  action: string;
  targetUrl?: string | null;
  method?: string | null;
  payloadSanitized: Record<string, unknown>;
  reason: string;
  simulatedResult: Record<string, unknown>;
}
