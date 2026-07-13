// ============================================================================
// AgentAdapterRegistry — Catálogo de adapters do Runtime.
// Cada agente registrado no AgentRegistry recebe um StubAgentAdapter.
// Nenhum agente é executado.
// ============================================================================

import type { AgentRegistry } from "./AgentRegistry.server";
import { StubAgentAdapter, type AgentAdapter, type AdapterHealthSnapshot } from "./AgentAdapter.server";

export interface AdapterEntry {
  agentId: string;
  version: string;
  executionMode: string;
  supportedJobs: string[];
  health: AdapterHealthSnapshot;
}

export class AgentAdapterRegistry {
  private readonly adapters = new Map<string, AgentAdapter>();

  constructor(agentRegistry: AgentRegistry) {
    for (const a of agentRegistry.list()) {
      this.adapters.set(
        a.descriptor.id,
        new StubAgentAdapter(a.descriptor.id, `stub-${a.descriptor.version}`, [
          `runtime:${a.descriptor.id}`,
        ]),
      );
    }
  }

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.agentId, adapter);
  }

  get(agentId: string): AgentAdapter | null {
    return this.adapters.get(agentId) ?? null;
  }

  list(): AgentAdapter[] {
    return Array.from(this.adapters.values());
  }

  size(): number {
    return this.adapters.size;
  }

  snapshot(agentRegistry: AgentRegistry): AdapterEntry[] {
    return this.list().map((ad) => {
      const agent = agentRegistry.get(ad.agentId);
      return {
        agentId: ad.agentId,
        version: ad.version,
        executionMode: agent?.descriptor.executionMode ?? "unknown",
        supportedJobs: ad.supportedJobs,
        health: ad.health(),
      };
    });
  }
}
