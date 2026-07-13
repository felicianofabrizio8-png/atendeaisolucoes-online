// ============================================================================
// ProfessorAdapter — Etapa 11: consome scientific-memory, business-learning
// e business-patterns. Publica professor-insights.
// ============================================================================

import { ProducerConsumerAdapterBase } from "./ProducerConsumerAdapterBase.server";
import type { IntelligenceProbeContext, IntelligenceProbeOutput } from "./IntelligenceAdapterBase.server";

export class ProfessorAdapter extends ProducerConsumerAdapterBase {
  readonly agentId = "professor";
  constructor() {
    super();
    (this as { supportedJobs: string[] }).supportedJobs = ["runtime:professor"];
    this.consumedTopics = [
      { topic: "scientific-memory", agentId: "scientific-memory" },
      { topic: "business-learning", agentId: "business-learning" },
      { topic: "business-patterns", agentId: "business-brain" },
    ];
    this.producedTopic = { topic: "professor-insights", priority: "normal" };
  }

  protected async probe({ supabase, companyId }: IntelligenceProbeContext): Promise<IntelligenceProbeOutput> {
    const { ScientificMemoryAgent } = await import("@/lib/scientific-memory/ScientificMemoryAgent.server");
    const memory = new ScientificMemoryAgent({ supabase, companyId });
    const latest = await memory.latest();
    const record = latest.record;
    const conclusionsCount = record?.businessConclusions?.length ?? 0;
    const correlationsCount = record?.correlations?.length ?? 0;
    const insightsCount = conclusionsCount + correlationsCount;
    return {
      reason: "professor_read_ok",
      detail: {
        hasMemory: Boolean(record),
        insightsCount,
        conclusionsCount,
        correlationsCount,
        divergencesCount: 0,
        behaviorChangesCount: record?.strengtheningHypotheses?.length ?? 0,
        knowledgeScore: record?.knowledgeScore ?? 0,
        confidence: record?.scientificScore ?? 0,
        generatedAt: record?.generatedAt ?? null,
      },
    };
  }

  protected buildPublishMetadata(detail: Record<string, unknown> | null) {
    if (!detail || !detail.hasMemory) return null;
    return {
      insightsCount: Number(detail.insightsCount ?? 0),
      conclusionsCount: Number(detail.conclusionsCount ?? 0),
      correlationsCount: Number(detail.correlationsCount ?? 0),
      divergencesCount: Number(detail.divergencesCount ?? 0),
      behaviorChangesCount: Number(detail.behaviorChangesCount ?? 0),
      knowledgeScore: Number(detail.knowledgeScore ?? 0),
      confidence: Number(detail.confidence ?? 0),
      generatedAt: (detail.generatedAt as string | null) ?? null,
    };
  }
}
