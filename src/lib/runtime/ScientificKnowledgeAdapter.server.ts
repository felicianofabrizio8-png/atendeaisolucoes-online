// ============================================================================
// ScientificKnowledgeAdapter — Etapa 11: consome business-learning e
// business-patterns; publica scientific-observations e (se houver) theories.
// ============================================================================

import { ProducerConsumerAdapterBase, type PublishPlan } from "./ProducerConsumerAdapterBase.server";
import type { IntelligenceProbeContext, IntelligenceProbeOutput } from "./IntelligenceAdapterBase.server";

interface Snap {
  period?: string;
  generatedAt?: string;
  observations?: unknown[];
  hypotheses?: unknown[];
  evidence?: unknown[];
  theories?: unknown[];
  validatedKnowledge?: Array<{ scientificScore?: number }>;
  sample?: { distinctSnapshotDays?: number };
}

export class ScientificKnowledgeAdapter extends ProducerConsumerAdapterBase {
  readonly agentId = "scientific-knowledge";
  constructor() {
    super();
    (this as { supportedJobs: string[] }).supportedJobs = ["runtime:scientific-knowledge"];
    this.consumedTopics = [
      { topic: "business-learning", agentId: "business-learning" },
      { topic: "business-patterns", agentId: "business-brain" },
    ];
    this.producedTopic = { topic: "scientific-observations", priority: "normal" };
  }

  protected async probe({ supabase, companyId }: IntelligenceProbeContext): Promise<IntelligenceProbeOutput> {
    const { ScientificKnowledgeAgent } = await import("@/lib/scientific-knowledge/ScientificKnowledgeAgent.server");
    const agent = new ScientificKnowledgeAgent({ supabase, companyId });
    const snap = (await agent.snapshot("30d")) as Snap;
    const validated = snap.validatedKnowledge ?? [];
    const scientificScore =
      validated.length > 0
        ? validated.reduce((a, v) => a + (v.scientificScore ?? 0), 0) / validated.length
        : 0;
    return {
      reason: "scientific_knowledge_snapshot_ok",
      detail: {
        period: snap.period ?? "30d",
        generatedAt: snap.generatedAt ?? null,
        observationsCount: (snap.observations ?? []).length,
        hypothesesCount: (snap.hypotheses ?? []).length,
        evidenceCount: (snap.evidence ?? []).length,
        theoriesCount: (snap.theories ?? []).length,
        validatedKnowledgeCount: validated.length,
        distinctHistoryDays: snap.sample?.distinctSnapshotDays ?? 0,
        scientificScore,
      },
    };
  }

  protected buildPublishMetadata(detail: Record<string, unknown> | null) {
    if (!detail) return null;
    return {
      observationsCount: Number(detail.observationsCount ?? 0),
      hypothesesCount: Number(detail.hypothesesCount ?? 0),
      evidenceCount: Number(detail.evidenceCount ?? 0),
      theoriesCount: Number(detail.theoriesCount ?? 0),
      validatedKnowledgeCount: Number(detail.validatedKnowledgeCount ?? 0),
      distinctHistoryDays: Number(detail.distinctHistoryDays ?? 0),
      scientificScore: Number(detail.scientificScore ?? 0),
      period: String(detail.period ?? "30d"),
      generatedAt: (detail.generatedAt as string | null) ?? null,
    };
  }

  protected buildExtraPublishes(detail: Record<string, unknown> | null): PublishPlan[] {
    if (!detail) return [];
    const theoriesCount = Number(detail.theoriesCount ?? 0);
    if (theoriesCount <= 0) return [];
    return [
      {
        producedTopic: { topic: "scientific-theories", priority: "high" },
        metadata: {
          theoriesCount,
          validatedKnowledgeCount: Number(detail.validatedKnowledgeCount ?? 0),
          scientificScore: Number(detail.scientificScore ?? 0),
          distinctHistoryDays: Number(detail.distinctHistoryDays ?? 0),
          period: String(detail.period ?? "30d"),
          generatedAt: (detail.generatedAt as string | null) ?? null,
        },
      },
    ];
  }
}
