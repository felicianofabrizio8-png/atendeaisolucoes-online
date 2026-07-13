// ============================================================================
// ExecutiveIntelligenceAdapter — Etapa 11: consome professor-insights e
// publica executive-summary.
// ============================================================================

import { ProducerConsumerAdapterBase } from "./ProducerConsumerAdapterBase.server";
import type { IntelligenceProbeContext, IntelligenceProbeOutput } from "./IntelligenceAdapterBase.server";

interface Bundle {
  insights?: Array<{ level?: string }>;
  generatedAt?: string;
  period?: string;
  dataQuality?: { warnings?: string[]; tablesEmpty?: string[] };
}

export class ExecutiveIntelligenceAdapter extends ProducerConsumerAdapterBase {
  readonly agentId = "executive-intelligence";
  constructor() {
    super();
    (this as { supportedJobs: string[] }).supportedJobs = ["runtime:executive-intelligence"];
    this.consumedTopics = [{ topic: "professor-insights", agentId: "professor" }];
    this.producedTopic = { topic: "executive-summary", priority: "high" };
  }

  protected async probe({ supabase, companyId }: IntelligenceProbeContext): Promise<IntelligenceProbeOutput> {
    const { ExecutiveAgent } = await import("@/lib/executive-ai/ExecutiveAgent.server");
    const agent = new ExecutiveAgent({ supabase, companyId });
    const bundle = (await agent.snapshot("30d")) as unknown as Bundle;
    const insights = bundle.insights ?? [];
    const highPriority = insights.filter((i) => i.level === "critical").length;
    const warnings = insights.filter((i) => i.level === "warn").length;
    const empty = bundle.dataQuality?.tablesEmpty?.length ?? 0;
    const dataQualityLevel = empty > 0 ? "partial" : "ok";
    return {
      reason: "executive_intelligence_snapshot_ok",
      detail: {
        insightCount: insights.length,
        highPriorityCount: highPriority,
        warningCount: warnings,
        period: bundle.period ?? "30d",
        generatedAt: bundle.generatedAt ?? null,
        dataQualityLevel,
      },
    };
  }

  protected buildPublishMetadata(detail: Record<string, unknown> | null) {
    if (!detail) return null;
    return {
      insightCount: Number(detail.insightCount ?? 0),
      highPriorityCount: Number(detail.highPriorityCount ?? 0),
      warningCount: Number(detail.warningCount ?? 0),
      period: String(detail.period ?? "30d"),
      generatedAt: (detail.generatedAt as string | null) ?? null,
      dataQualityLevel: String(detail.dataQualityLevel ?? "ok"),
    };
  }
}
