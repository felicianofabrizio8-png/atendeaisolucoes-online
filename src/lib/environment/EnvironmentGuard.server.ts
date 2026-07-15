// EnvironmentGuard — fronteira central de decisão para toda ação externa.
//
// Contrato:
//   - kill switch OFF                → { proceed: true, environment: "legacy" }
//   - environment = production       → { proceed: true, environment: "production" }
//   - environment = staging          → { proceed: false, ..., reason: "staging_tenant" }
//   - lookup falhou / unknown        → { proceed: false, ..., reason: "lookup_failed" }
//   - logger falhou (staging/unknown)→ { proceed: false, ..., reason: "logger_failed",
//                                        simulationId: null, logError: true }
//
// NUNCA transforma falha de log em envio real.
// NUNCA lança — retorna sempre um GuardDecision.
//
// Injeções opcionais (`deps`) existem para testes; em produção usa defaults.

import { isGuardEnabled } from "./killSwitch";
import { getEnvironment } from "./EnvironmentRepository.server";
import { logSimulation, type LogResult } from "./SimulationLogger.server";
import { sanitizePayload } from "./sanitize";
import type { GuardDecision, OutboundAction, SimulationRecord } from "./types";

export interface GuardDeps {
  isEnabled?: () => Promise<boolean>;
  lookupEnv?: typeof getEnvironment;
  logger?: (rec: SimulationRecord) => Promise<LogResult>;
}

export async function assertOutbound(
  action: OutboundAction,
  deps: GuardDeps = {},
): Promise<GuardDecision> {
  const isEnabled = deps.isEnabled ?? isGuardEnabled;
  const lookup = deps.lookupEnv ?? getEnvironment;
  const logger = deps.logger ?? logSimulation;

  // 1) Kill switch — comportamento legado quando desligado.
  let enabled = false;
  try {
    enabled = await isEnabled();
  } catch {
    enabled = false; // fail-open p/ legado; guard nunca deve derrubar produção
  }
  if (!enabled) {
    return { proceed: true, environment: "legacy" };
  }

  // 2) Descobre ambiente.
  const envLookup = await lookup(action.companyId);
  if (envLookup.ok && envLookup.environment === "production") {
    return { proceed: true, environment: "production" };
  }

  // 3) staging OU unknown → simular. Nunca prosseguir.
  const isUnknown = !envLookup.ok;
  const reason: "staging_tenant" | "lookup_failed" = isUnknown
    ? "lookup_failed"
    : "staging_tenant";

  const sanitized = sanitizePayload({
    payload: action.payload,
    targetUrl: action.targetUrl,
    method: action.method,
  });

  const record: SimulationRecord = {
    companyId: action.companyId,
    userId: action.userId ?? null,
    agentId: action.agentId ?? null,
    action: action.action,
    targetUrl: action.targetUrl ?? null,
    method: action.method ?? null,
    payloadSanitized: sanitized,
    reason,
    simulatedResult: {
      success: true,
      simulated: true,
      externalRequestSent: false,
    },
  };

  let log: LogResult;
  try {
    log = await logger(record);
  } catch (e) {
    log = { ok: false, id: null, error: e instanceof Error ? e.message : String(e) };
  }

  if (!log.ok) {
    // Fail-safe: log falhou, mas ainda assim BLOQUEIA.
    // eslint-disable-next-line no-console
    console.error("[EnvironmentGuard] logger failed, still blocking", log.error);
    return {
      proceed: false,
      environment: isUnknown ? "unknown" : "staging",
      simulationId: null,
      reason: "logger_failed",
      logError: true,
    };
  }

  return {
    proceed: false,
    environment: isUnknown ? "unknown" : "staging",
    simulationId: log.id,
    reason,
  };
}
