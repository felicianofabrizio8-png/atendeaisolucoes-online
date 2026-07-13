// ============================================================================
// BusinessBrainAdapter — READ-ONLY. Etapa 11: publica em `business-patterns`.
// ============================================================================

import { ProducerConsumerAdapterBase } from "./ProducerConsumerAdapterBase.server";
import type { IntelligenceProbeContext, IntelligenceProbeOutput } from "./IntelligenceAdapterBase.server";

interface Snap {
  period?: string;
  generatedAt?: string;
  patterns?: Array<{ category?: string; confidence?: number }>;
  knowledge?: unknown[];
  sample?: { conversationFacts?: number };
}

export class BusinessBrainAdapter extends ProducerConsumerAdapterBase {
  readonly agentId = "business-brain";
  constructor() {
    super();
    (this as { supportedJobs: string[] }).supportedJobs = ["runtime:business-brain"];
    this.producedTopic = { topic: "business-patterns", priority: "normal" };
  }

  protected async probe({ supabase, companyId }: IntelligenceProbeContext): Promise<IntelligenceProbeOutput> {
    const { BusinessBrainAgent } = await import("@/lib/business-brain/BusinessBrainAgent.server");
    const agent = new BusinessBrainAgent({ supabase, companyId });
    const snap = (await agent.snapshot("30d")) as Snap;
    const patterns = snap.patterns ?? [];
    const knowledge = snap.knowledge ?? [];
    const catCount = new Map<string, number>();
    for (const p of patterns) {
      const c = p.category ?? "unknown";
      catCount.set(c, (catCount.get(c) ?? 0) + 1);
    }
    const topCategories = Array.from(catCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([c]) => c)
      .join(",");
    const avgConfidence =
      patterns.length > 0
        ? patterns.reduce((a, p) => a + (p.confidence ?? 0), 0) / patterns.length
        : 0;
    return {
      reason: "business_brain_snapshot_ok",
      detail: {
        period: snap.period ?? "30d",
        generatedAt: snap.generatedAt ?? null,
        patternsCount: patterns.length,
        knowledgeCount: knowledge.length,
        factsCount: snap.sample?.conversationFacts ?? 0,
        topCategories,
        confidence: avgConfidence,
      },
    };
  }

  protected buildPublishMetadata(detail: Record<string, unknown> | null) {
    if (!detail) return null;
    return {
      patternsCount: Number(detail.patternsCount ?? 0),
      knowledgeCount: Number(detail.knowledgeCount ?? 0),
      factsCount: Number(detail.factsCount ?? 0),
      topCategories: String(detail.topCategories ?? ""),
      confidence: Number(detail.confidence ?? 0),
      period: String(detail.period ?? "30d"),
      generatedAt: (detail.generatedAt as string | null) ?? null,
    };
  }
}
