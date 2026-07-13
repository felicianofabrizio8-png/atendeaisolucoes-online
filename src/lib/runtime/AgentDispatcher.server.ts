// ============================================================================
// AgentDispatcher — Interface de despacho.
// Etapa 1: apenas contratos. NÃO executa nenhum agente.
// ============================================================================

import { RuntimeClock } from "./RuntimeClock.server";
import type { AgentRegistry } from "./AgentRegistry.server";
import type { DispatchRequest, DispatchResult } from "./RuntimeTypes";

export class AgentDispatcher {
  constructor(private readonly registry: AgentRegistry) {}

  /** NOOP nesta etapa: valida e retorna, sem executar nada. */
  dispatch(req: DispatchRequest): DispatchResult {
    const agent = this.registry.get(req.agentId);
    if (!agent) {
      return {
        accepted: false,
        reason: "agent_not_found",
        agentId: req.agentId,
        dispatchedAt: RuntimeClock.nowIso(),
      };
    }
    if (!agent.descriptor.enabled || agent.descriptor.executionMode === "disabled") {
      return {
        accepted: false,
        reason: "agent_disabled",
        agentId: req.agentId,
        dispatchedAt: RuntimeClock.nowIso(),
      };
    }
    return {
      accepted: false,
      reason: "foundation_only_no_execution",
      agentId: req.agentId,
      dispatchedAt: RuntimeClock.nowIso(),
    };
  }

  cancel(_agentId: string): { cancelled: boolean; reason: string } {
    return { cancelled: false, reason: "foundation_only_no_execution" };
  }

  status(agentId: string) {
    const a = this.registry.get(agentId);
    if (!a) return null;
    return { id: agentId, status: a.state.status, health: a.state.health };
  }

  /** Reservado para etapas futuras. */
  schedule(_req: DispatchRequest, _whenIso: string): DispatchResult {
    return {
      accepted: false,
      reason: "foundation_only_no_execution",
      agentId: _req.agentId,
      dispatchedAt: RuntimeClock.nowIso(),
    };
  }
}
