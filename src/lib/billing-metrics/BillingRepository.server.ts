// ============================================================================
// Billing Metrics — Repository (append-only)
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { BillingDailyAggregate, BillingEventInput } from "./BillingTypes";

export class BillingRepository {
  constructor(private readonly writer: SupabaseClient<Database>) {}

  async record(input: BillingEventInput): Promise<void> {
    const { error } = await this.writer.from("billing_usage_events").insert({
      company_id: input.companyId,
      metric: input.metric,
      value: Math.max(0, Math.floor(input.value)),
      unit: input.unit ?? "count",
      provider: input.provider ?? null,
      occurred_at: (input.occurredAt ?? new Date()).toISOString(),
      metadata: (input.metadata ?? {}) as Database["public"]["Tables"]["billing_usage_events"]["Insert"]["metadata"],
    });
    if (error) throw new Error(`[Billing.record] ${error.message}`);
  }

  async recordMany(inputs: BillingEventInput[]): Promise<void> {
    if (!inputs.length) return;
    const rows = inputs.map((i) => ({
      company_id: i.companyId,
      metric: i.metric,
      value: Math.max(0, Math.floor(i.value)),
      unit: i.unit ?? "count",
      provider: i.provider ?? null,
      occurred_at: (i.occurredAt ?? new Date()).toISOString(),
      metadata: (i.metadata ?? {}) as Database["public"]["Tables"]["billing_usage_events"]["Insert"]["metadata"],
    }));
    const { error } = await this.writer.from("billing_usage_events").insert(rows);
    if (error) throw new Error(`[Billing.recordMany] ${error.message}`);
  }

  async aggregateDaily(companyId: string, sinceDays = 30): Promise<BillingDailyAggregate[]> {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - sinceDays);
    const { data, error } = await this.writer
      .from("billing_usage_events")
      .select("metric, period_day, value")
      .eq("company_id", companyId)
      .gte("occurred_at", since.toISOString())
      .limit(50_000);
    if (error) throw new Error(`[Billing.aggregateDaily] ${error.message}`);

    const acc = new Map<string, BillingDailyAggregate>();
    for (const row of data ?? []) {
      const key = `${row.metric}::${row.period_day}`;
      const prev = acc.get(key);
      if (prev) {
        prev.total += Number(row.value);
      } else {
        acc.set(key, {
          companyId,
          metric: row.metric,
          periodDay: String(row.period_day),
          total: Number(row.value),
        });
      }
    }
    return [...acc.values()].sort((a, b) =>
      a.periodDay === b.periodDay ? a.metric.localeCompare(b.metric) : a.periodDay.localeCompare(b.periodDay),
    );
  }
}
