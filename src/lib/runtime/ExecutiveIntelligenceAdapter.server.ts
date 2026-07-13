// ============================================================================
// ExecutiveIntelligenceAdapter — Adapter real do agente Executive Intelligence.
// READ-ONLY: chama ExecutiveAgent.metrics("30d") (mais leve que snapshot).
// ============================================================================

import { IntelligenceAdapterBase, type IntelligenceProbeContext, type IntelligenceProbeOutput } from "./IntelligenceAdapterBase.server";

export class ExecutiveIntelligenceAdapter extends IntelligenceAdapterBase {
  readonly agentId = "executive-intelligence";
  constructor() {
    super();
    (this as { supportedJobs: string[] }).supportedJobs = ["runtime:executive-intelligence"];
  }

  protected async probe({ supabase, companyId }: IntelligenceProbeContext): Promise<IntelligenceProbeOutput> {
    const { ExecutiveAgent } = await import("@/lib/executive-ai/ExecutiveAgent.server");
    const agent = new ExecutiveAgent({ supabase, companyId });
    const metrics = await agent.metrics("30d");
    return {
      reason: "executive_intelligence_metrics_ok",
      detail: {
        period: "30d",
        hasMetrics: Boolean(metrics),
      },
    };
  }
}
