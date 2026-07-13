// ============================================================================
// ScientificMemoryAdapter — Etapa 11: consome observações e teorias
// científicas e publica scientific-memory.
// ============================================================================

import { ProducerConsumerAdapterBase } from "./ProducerConsumerAdapterBase.server";
import type { IntelligenceProbeContext, IntelligenceProbeOutput } from "./IntelligenceAdapterBase.server";

export class ScientificMemoryAdapter extends ProducerConsumerAdapterBase {
  readonly agentId = "scientific-memory";
  constructor() {
    super();
    (this as { supportedJobs: string[] }).supportedJobs = ["runtime:scientific-memory"];
    this.consumedTopics = [
      { topic: "scientific-observations", agentId: "scientific-knowledge" },
      { topic: "scientific-theories", agentId: "scientific-knowledge" },
    ];
    this.producedTopic = { topic: "scientific-memory", priority: "high" };
  }

  protected async probe({ supabase, companyId }: IntelligenceProbeContext): Promise<IntelligenceProbeOutput> {
    const { ScientificMemoryAgent } = await import("@/lib/scientific-memory/ScientificMemoryAgent.server");
    const agent = new ScientificMemoryAgent({ supabase, companyId });
    const latest = await agent.latest();
    const record = latest.record;
    return {
      reason: "scientific_memory_read_ok",
      detail: {
        hasRecord: Boolean(record),
        knowledgeScore: record?.knowledgeScore ?? 0,
        scientificScore: record?.scientificScore ?? 0,
        validatedTheoriesCount: record?.validatedTheories?.length ?? 0,
        strengtheningHypothesesCount: record?.strengtheningHypotheses?.length ?? 0,
        observedPatternsCount: record?.observedPatterns?.length ?? 0,
        businessConclusionsCount: record?.businessConclusions?.length ?? 0,
        memoryDate: record?.memoryDate ?? null,
        evolutionStatus: latest.evolution?.status ?? null,
      },
    };
  }

  protected buildPublishMetadata(detail: Record<string, unknown> | null) {
    if (!detail || !detail.hasRecord) return null;
    return {
      knowledgeScore: Number(detail.knowledgeScore ?? 0),
      scientificScore: Number(detail.scientificScore ?? 0),
      validatedTheoriesCount: Number(detail.validatedTheoriesCount ?? 0),
      strengtheningHypothesesCount: Number(detail.strengtheningHypothesesCount ?? 0),
      observedPatternsCount: Number(detail.observedPatternsCount ?? 0),
      businessConclusionsCount: Number(detail.businessConclusionsCount ?? 0),
      memoryDate: (detail.memoryDate as string | null) ?? null,
      evolutionStatus: (detail.evolutionStatus as string | null) ?? null,
    };
  }
}
