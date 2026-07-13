// ============================================================================
// ScientificMemoryAdapter — Adapter real do agente Scientific Memory.
// READ-ONLY: chama ScientificMemoryAgent.latest() (não persiste nada).
// ============================================================================

import { IntelligenceAdapterBase, type IntelligenceProbeContext, type IntelligenceProbeOutput } from "./IntelligenceAdapterBase.server";

export class ScientificMemoryAdapter extends IntelligenceAdapterBase {
  readonly agentId = "scientific-memory";
  constructor() {
    super();
    (this as { supportedJobs: string[] }).supportedJobs = ["runtime:scientific-memory"];
  }

  protected async probe({ supabase, companyId }: IntelligenceProbeContext): Promise<IntelligenceProbeOutput> {
    const { ScientificMemoryAgent } = await import("@/lib/scientific-memory/ScientificMemoryAgent.server");
    const agent = new ScientificMemoryAgent({ supabase, companyId });
    const latest = await agent.latest();
    return {
      reason: "scientific_memory_read_ok",
      detail: {
        hasRecord: Boolean(latest.record),
        evolutionTrend: (latest.evolution as { trend?: string } | null)?.trend ?? null,
      },
    };
  }
}
