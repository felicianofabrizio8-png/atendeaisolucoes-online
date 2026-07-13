// ============================================================================
// ProfessorAdapter — Adapter real do agente Professor AI.
// Professor não possui módulo próprio: sua execução consiste em ler a
// memória científica (dependência declarada no AgentRegistry). READ-ONLY.
// ============================================================================

import { IntelligenceAdapterBase, type IntelligenceProbeContext, type IntelligenceProbeOutput } from "./IntelligenceAdapterBase.server";

export class ProfessorAdapter extends IntelligenceAdapterBase {
  readonly agentId = "professor";
  constructor() {
    super();
    (this as { supportedJobs: string[] }).supportedJobs = ["runtime:professor"];
  }

  protected async probe({ supabase, companyId }: IntelligenceProbeContext): Promise<IntelligenceProbeOutput> {
    const { ScientificMemoryAgent } = await import("@/lib/scientific-memory/ScientificMemoryAgent.server");
    const memory = new ScientificMemoryAgent({ supabase, companyId });
    const latest = await memory.latest();
    return {
      reason: "professor_read_ok",
      detail: {
        hasMemory: Boolean(latest.record),
      },
    };
  }
}
