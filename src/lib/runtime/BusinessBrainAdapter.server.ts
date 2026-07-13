// ============================================================================
// BusinessBrainAdapter — Adapter real do agente Business Brain.
// READ-ONLY: chama BusinessBrainAgent.snapshot("30d"). Não escreve nada.
// ============================================================================

import { IntelligenceAdapterBase, type IntelligenceProbeContext, type IntelligenceProbeOutput } from "./IntelligenceAdapterBase.server";

export class BusinessBrainAdapter extends IntelligenceAdapterBase {
  readonly agentId = "business-brain";
  constructor() {
    super();
    (this as { supportedJobs: string[] }).supportedJobs = ["runtime:business-brain"];
  }

  protected async probe({ supabase, companyId }: IntelligenceProbeContext): Promise<IntelligenceProbeOutput> {
    const { BusinessBrainAgent } = await import("@/lib/business-brain/BusinessBrainAgent.server");
    const agent = new BusinessBrainAgent({ supabase, companyId });
    const snap = await agent.snapshot("30d");
    return {
      reason: "business_brain_snapshot_ok",
      detail: {
        period: snap.period ?? "30d",
        generatedAt: (snap as { generatedAt?: string }).generatedAt ?? null,
      },
    };
  }
}
