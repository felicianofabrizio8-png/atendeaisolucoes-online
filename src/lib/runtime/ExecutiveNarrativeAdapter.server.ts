// ============================================================================
// ExecutiveNarrativeAdapter — Etapa 11: consumidor apenas. Lê
// executive-knowledge do Bus para telemetria; não publica.
// ============================================================================

import { ProducerConsumerAdapterBase } from "./ProducerConsumerAdapterBase.server";
import type { IntelligenceProbeContext, IntelligenceProbeOutput } from "./IntelligenceAdapterBase.server";

export class ExecutiveNarrativeAdapter extends ProducerConsumerAdapterBase {
  readonly agentId = "executive-narrative";
  constructor() {
    super();
    (this as { supportedJobs: string[] }).supportedJobs = ["runtime:executive-narrative"];
    this.consumedTopics = [{ topic: "executive-knowledge", agentId: "executive-knowledge" }];
    this.producedTopic = null; // não publica nesta etapa
  }

  protected async probe({ supabase, companyId }: IntelligenceProbeContext): Promise<IntelligenceProbeOutput> {
    const hasApiKey = Boolean(process.env.LOVABLE_API_KEY);
    const { ExecutiveKnowledgeService } = await import("@/lib/executive-knowledge/ExecutiveKnowledgeService.server");
    const prereq = await ExecutiveKnowledgeService.latest(supabase, companyId, "30d");
    const svc = await import("@/lib/executive-narrative/ExecutiveNarrativeService.server");
    if (!svc?.ExecutiveNarrativeService) {
      throw new Error("narrative_service_missing");
    }
    return {
      reason: "executive_narrative_ready",
      detail: {
        hasApiKey,
        hasKnowledgePrereq: Boolean(prereq),
        mode: "readiness_check",
      },
    };
  }
}
