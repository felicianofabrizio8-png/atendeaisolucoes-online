// ============================================================================
// BusinessLearningAdapter — Adapter real do agente Business Learning.
// READ-ONLY: chama BusinessLearningAgent.snapshot("30d").
// ============================================================================

import { IntelligenceAdapterBase, type IntelligenceProbeContext, type IntelligenceProbeOutput } from "./IntelligenceAdapterBase.server";

export class BusinessLearningAdapter extends IntelligenceAdapterBase {
  readonly agentId = "business-learning";
  constructor() {
    super();
    (this as { supportedJobs: string[] }).supportedJobs = ["runtime:business-learning"];
  }

  protected async probe({ supabase, companyId }: IntelligenceProbeContext): Promise<IntelligenceProbeOutput> {
    const { BusinessLearningAgent } = await import("@/lib/business-learning/BusinessLearningAgent.server");
    const agent = new BusinessLearningAgent({ supabase, companyId });
    const snap = await agent.snapshot("30d");
    return {
      reason: "business_learning_snapshot_ok",
      detail: {
        period: (snap as { period?: string }).period ?? "30d",
        generatedAt: (snap as { generatedAt?: string }).generatedAt ?? null,
      },
    };
  }
}
