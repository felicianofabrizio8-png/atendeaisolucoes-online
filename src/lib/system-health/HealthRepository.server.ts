// ============================================================================
// System Health — Repository
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { HealthSampleInput } from "./HealthTypes";

export class HealthRepository {
  constructor(private readonly writer: SupabaseClient<Database>) {}

  async insert(sample: HealthSampleInput): Promise<void> {
    const { error } = await this.writer.from("system_health_samples").insert({
      metric: sample.metric,
      value: Number(sample.value),
      company_id: sample.companyId ?? null,
      tags: (sample.tags ?? {}) as Database["public"]["Tables"]["system_health_samples"]["Insert"]["tags"],
      collected_at: (sample.collectedAt ?? new Date()).toISOString(),
    });
    if (error) throw new Error(`[Health.insert] ${error.message}`);
  }

  async insertMany(samples: HealthSampleInput[]): Promise<void> {
    if (!samples.length) return;
    const rows = samples.map((s) => ({
      metric: s.metric,
      value: Number(s.value),
      company_id: s.companyId ?? null,
      tags: (s.tags ?? {}) as Database["public"]["Tables"]["system_health_samples"]["Insert"]["tags"],
      collected_at: (s.collectedAt ?? new Date()).toISOString(),
    }));
    const { error } = await this.writer.from("system_health_samples").insert(rows);
    if (error) throw new Error(`[Health.insertMany] ${error.message}`);
  }

  async latestByMetric(metric: string, sinceMinutes = 60): Promise<number | null> {
    const since = new Date(Date.now() - sinceMinutes * 60_000);
    const { data, error } = await this.writer
      .from("system_health_samples")
      .select("value")
      .eq("metric", metric)
      .gte("collected_at", since.toISOString())
      .order("collected_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`[Health.latest] ${error.message}`);
    return data ? Number(data.value) : null;
  }
}
