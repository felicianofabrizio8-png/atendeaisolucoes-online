// ============================================================================
// System Health — Service
// Produz snapshots agregados READ-ONLY para o endpoint /api/system-health.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { HealthCollector } from "./HealthCollector.server";
import { HealthRepository } from "./HealthRepository.server";
import type { HealthSnapshot } from "./HealthTypes";

export class HealthService {
  readonly repo: HealthRepository;
  readonly collector: HealthCollector;

  constructor(private readonly writer: SupabaseClient<Database>) {
    this.repo = new HealthRepository(writer);
    this.collector = new HealthCollector(writer);
  }

  async snapshot(companyId?: string): Promise<HealthSnapshot> {
    const queuePending = await this.count("agent_jobs", "status", "pending", companyId);
    const queueProcessing = await this.count("agent_jobs", "status", "processing", companyId);
    const queueDead = await this.count("agent_jobs", "status", "dead_letter", companyId);

    const [dbLatency, llmLatency, metaLatency, storageLatency] = await Promise.all([
      this.repo.latestByMetric("db_latency_ms"),
      this.repo.latestByMetric("llm_latency_ms"),
      this.repo.latestByMetric("meta_latency_ms"),
      this.repo.latestByMetric("storage_latency_ms"),
    ]);

    const [llmCalls, messagesOut] = companyId
      ? await Promise.all([
          this.billingSum(companyId, "llm_calls"),
          this.billingSum(companyId, "messages_out"),
        ])
      : [0, 0];

    return {
      collectedAt: new Date().toISOString(),
      queue: {
        pending: queuePending,
        processing: queueProcessing,
        deadLetter: queueDead,
      },
      latency: {
        db: dbLatency,
        llm: llmLatency,
        meta: metaLatency,
        storage: storageLatency,
      },
      billing: {
        llmCallsLast24h: llmCalls,
        messagesLast24h: messagesOut,
      },
    };
  }

  private async count(
    table: "agent_jobs",
    column: string,
    value: string,
    companyId?: string,
  ): Promise<number> {
    let q = this.writer.from(table).select("id", { count: "exact", head: true }).eq(column, value);
    if (companyId) q = q.eq("company_id", companyId);
    const { count } = await q;
    return count ?? 0;
  }

  private async billingSum(companyId: string, metric: string): Promise<number> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await this.writer
      .from("billing_usage_events")
      .select("value")
      .eq("company_id", companyId)
      .eq("metric", metric)
      .gte("occurred_at", since)
      .limit(10_000);
    return (data ?? []).reduce((acc, r) => acc + Number(r.value), 0);
  }
}
