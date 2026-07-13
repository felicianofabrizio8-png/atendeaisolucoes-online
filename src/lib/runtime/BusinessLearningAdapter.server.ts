// ============================================================================
// BusinessLearningAdapter — Etapa 11: consome business-patterns e publica
// em business-learning. READ-ONLY.
// ============================================================================

import { ProducerConsumerAdapterBase } from "./ProducerConsumerAdapterBase.server";
import type { IntelligenceProbeContext, IntelligenceProbeOutput } from "./IntelligenceAdapterBase.server";

interface Snap {
  period?: string;
  generatedAt?: string;
  hypotheses?: Array<{ confidence?: number }>;
  evolution?: Array<{ direction?: string }>;
  learning?: unknown[];
}

export class BusinessLearningAdapter extends ProducerConsumerAdapterBase {
  readonly agentId = "business-learning";
  constructor() {
    super();
    (this as { supportedJobs: string[] }).supportedJobs = ["runtime:business-learning"];
    this.consumedTopics = [{ topic: "business-patterns", agentId: "business-brain" }];
    this.producedTopic = { topic: "business-learning", priority: "normal" };
  }

  protected async probe({ supabase, companyId }: IntelligenceProbeContext): Promise<IntelligenceProbeOutput> {
    const { BusinessLearningAgent } = await import("@/lib/business-learning/BusinessLearningAgent.server");
    const agent = new BusinessLearningAgent({ supabase, companyId });
    const snap = (await agent.snapshot("30d")) as Snap;
    const hypotheses = snap.hypotheses ?? [];
    const evolution = snap.evolution ?? [];
    const learning = snap.learning ?? [];
    const rising = evolution.filter((e) => e.direction === "rising").length;
    const falling = evolution.filter((e) => e.direction === "falling").length;
    const avgConfidence =
      hypotheses.length > 0
        ? hypotheses.reduce((a, h) => a + (h.confidence ?? 0), 0) / hypotheses.length
        : 0;
    return {
      reason: "business_learning_snapshot_ok",
      detail: {
        period: snap.period ?? "30d",
        generatedAt: snap.generatedAt ?? null,
        hypothesesCount: hypotheses.length,
        evolutionCount: evolution.length,
        learningCount: learning.length,
        risingCount: rising,
        fallingCount: falling,
        confidence: avgConfidence,
      },
    };
  }

  protected buildPublishMetadata(detail: Record<string, unknown> | null) {
    if (!detail) return null;
    return {
      hypothesesCount: Number(detail.hypothesesCount ?? 0),
      evolutionCount: Number(detail.evolutionCount ?? 0),
      learningCount: Number(detail.learningCount ?? 0),
      risingCount: Number(detail.risingCount ?? 0),
      fallingCount: Number(detail.fallingCount ?? 0),
      confidence: Number(detail.confidence ?? 0),
      period: String(detail.period ?? "30d"),
      generatedAt: (detail.generatedAt as string | null) ?? null,
    };
  }
}
