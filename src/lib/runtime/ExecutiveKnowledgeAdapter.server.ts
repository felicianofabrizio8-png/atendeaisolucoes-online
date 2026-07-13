// ============================================================================
// ExecutiveKnowledgeAdapter — Adapter real do agente Executive Knowledge.
// READ-ONLY: chama ExecutiveKnowledgeService.latest("30d").
// ============================================================================

import { IntelligenceAdapterBase, type IntelligenceProbeContext, type IntelligenceProbeOutput } from "./IntelligenceAdapterBase.server";

export class ExecutiveKnowledgeAdapter extends IntelligenceAdapterBase {
  readonly agentId = "executive-knowledge";
  constructor() {
    super();
    (this as { supportedJobs: string[] }).supportedJobs = ["runtime:executive-knowledge"];
  }

  protected async probe({ supabase, companyId }: IntelligenceProbeContext): Promise<IntelligenceProbeOutput> {
    const { ExecutiveKnowledgeService } = await import("@/lib/executive-knowledge/ExecutiveKnowledgeService.server");
    const latest = await ExecutiveKnowledgeService.latest(supabase, companyId, "30d");
    return {
      reason: "executive_knowledge_latest_ok",
      detail: {
        period: "30d",
        hasRecord: Boolean(latest),
      },
    };
  }
}
