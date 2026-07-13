// ============================================================================
// ExecutiveKnowledgeAdapter — Etapa 11: consome executive-summary e
// system-health (mantido da Etapa 10). Publica executive-knowledge.
// Skip-on-full-hit preservado da Etapa 10.
// ============================================================================

import { ProducerConsumerAdapterBase } from "./ProducerConsumerAdapterBase.server";
import type { IntelligenceProbeContext, IntelligenceProbeOutput } from "./IntelligenceAdapterBase.server";

export class ExecutiveKnowledgeAdapter extends ProducerConsumerAdapterBase {
  readonly agentId = "executive-knowledge";
  readonly version = "real-1.2.0";

  constructor() {
    super();
    (this as { supportedJobs: string[] }).supportedJobs = ["runtime:executive-knowledge"];
    this.consumedTopics = [
      { topic: "executive-summary", agentId: "executive-intelligence" },
      { topic: "system-health", agentId: "system-health" },
    ];
    this.producedTopic = { topic: "executive-knowledge", priority: "normal" };
    this.skipProbeOnFullHit = false;
  }

  protected async probe({ supabase, companyId }: IntelligenceProbeContext): Promise<IntelligenceProbeOutput> {
    const { ExecutiveKnowledgeService } = await import("@/lib/executive-knowledge/ExecutiveKnowledgeService.server");
    const latest = await ExecutiveKnowledgeService.latest(supabase, companyId, "30d");
    return {
      reason: "executive_knowledge_latest_ok",
      detail: {
        available: Boolean(latest),
        period: "30d",
        snapshotGeneratedAt: latest?.snapshotGeneratedAt ?? null,
        factsCount: latest ? Object.keys(latest.facts ?? {}).length : 0,
        highlightsCount: latest?.highlights?.length ?? 0,
        recommendationsCount: latest?.recommendations?.length ?? 0,
        confidence: 1,
      },
    };
  }

  protected buildPublishMetadata(detail: Record<string, unknown> | null) {
    if (!detail || !detail.available) return null;
    return {
      available: true,
      period: String(detail.period ?? "30d"),
      snapshotGeneratedAt: (detail.snapshotGeneratedAt as string | null) ?? null,
      factsCount: Number(detail.factsCount ?? 0),
      highlightsCount: Number(detail.highlightsCount ?? 0),
      recommendationsCount: Number(detail.recommendationsCount ?? 0),
      confidence: Number(detail.confidence ?? 1),
    };
  }
}
