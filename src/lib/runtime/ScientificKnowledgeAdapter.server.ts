// ============================================================================
// ScientificKnowledgeAdapter — Adapter real do agente Scientific Knowledge.
// READ-ONLY: chama ScientificKnowledgeAgent.snapshot("30d").
// ============================================================================

import { IntelligenceAdapterBase, type IntelligenceProbeContext, type IntelligenceProbeOutput } from "./IntelligenceAdapterBase.server";

export class ScientificKnowledgeAdapter extends IntelligenceAdapterBase {
  readonly agentId = "scientific-knowledge";
  constructor() {
    super();
    (this as { supportedJobs: string[] }).supportedJobs = ["runtime:scientific-knowledge"];
  }

  protected async probe({ supabase, companyId }: IntelligenceProbeContext): Promise<IntelligenceProbeOutput> {
    const { ScientificKnowledgeAgent } = await import("@/lib/scientific-knowledge/ScientificKnowledgeAgent.server");
    const agent = new ScientificKnowledgeAgent({ supabase, companyId });
    const snap = await agent.snapshot("30d");
    return {
      reason: "scientific_knowledge_snapshot_ok",
      detail: {
        period: (snap as { period?: string }).period ?? "30d",
        generatedAt: (snap as { generatedAt?: string }).generatedAt ?? null,
      },
    };
  }
}
