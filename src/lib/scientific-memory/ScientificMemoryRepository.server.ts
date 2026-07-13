// ============================================================================
// Scientific Memory — Repository (Fase 4 + Quality Gate)
// READ + INSERT idempotente. Gravação apenas server-side (service_role).
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  ScientificMemoryInsert,
  ScientificMemoryRecord,
  ScientificMemoryTimelineItem,
  ScientificMemoryPeriod,
  MemoryQuality,
  MemoryValidatedTheory,
  MemoryStrengtheningHypothesis,
  MemoryObservedPattern,
  MemoryBusinessConclusion,
  MemoryCorrelation,
  MemoryLimitation,
} from "./ScientificMemoryTypes";

interface RawRow {
  id: string;
  company_id: string;
  generated_at: string;
  memory_date: string;
  source_fingerprint: string;
  period: string;
  knowledge_score: number | string;
  scientific_score: number | string;
  validated_theories: unknown;
  strengthening_hypotheses: unknown;
  observed_patterns: unknown;
  business_conclusions: unknown;
  correlations: unknown;
  limitations: unknown;
  quality: unknown;
  version: string;
  created_at: string;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
function asObject<T extends object>(v: unknown, fallback: T): T {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as T) : fallback;
}
function asNumber(v: number | string): number {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

const emptyQuality: MemoryQuality = {
  observationsCount: 0,
  hypothesesCount: 0,
  evidenceCount: 0,
  theoriesCount: 0,
  validatedKnowledgeCount: 0,
  distinctSnapshotDays: 0,
  brainPatterns: 0,
  brainKnowledge: 0,
  avgConfidence: 0,
};

function mapRow(row: RawRow): ScientificMemoryRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    generatedAt: row.generated_at,
    memoryDate: row.memory_date,
    sourceFingerprint: row.source_fingerprint,
    period: row.period as ScientificMemoryPeriod,
    knowledgeScore: asNumber(row.knowledge_score),
    scientificScore: asNumber(row.scientific_score),
    validatedTheories: asArray<MemoryValidatedTheory>(row.validated_theories),
    strengtheningHypotheses: asArray<MemoryStrengtheningHypothesis>(row.strengthening_hypotheses),
    observedPatterns: asArray<MemoryObservedPattern>(row.observed_patterns),
    businessConclusions: asArray<MemoryBusinessConclusion>(row.business_conclusions),
    correlations: asArray<MemoryCorrelation>(row.correlations),
    limitations: asArray<MemoryLimitation>(row.limitations),
    quality: asObject<MemoryQuality>(row.quality, emptyQuality),
    version: row.version,
    createdAt: row.created_at,
  };
}

export interface InsertResult {
  record: ScientificMemoryRecord | null;
  alreadyExists: boolean;
}

export class ScientificMemoryRepository {
  private readonly supabase: SupabaseClient<Database>;
  private readonly companyId: string;

  constructor(supabase: SupabaseClient<Database>, companyId: string) {
    this.supabase = supabase;
    this.companyId = companyId;
  }

  async findByFingerprint(
    payload: ScientificMemoryInsert,
  ): Promise<ScientificMemoryRecord | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (this.supabase as any)
      .from("scientific_memory")
      .select("*")
      .eq("company_id", this.companyId)
      .eq("period", payload.period)
      .eq("version", payload.version)
      .eq("memory_date", payload.memoryDate)
      .eq("source_fingerprint", payload.sourceFingerprint)
      .maybeSingle();
    if (error || !data) return null;
    return mapRow(data as RawRow);
  }

  async insert(payload: ScientificMemoryInsert): Promise<InsertResult> {
    const existing = await this.findByFingerprint(payload);
    if (existing) return { record: existing, alreadyExists: true };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.supabase as any;
    const { data, error } = await client
      .from("scientific_memory")
      .insert({
        company_id: this.companyId,
        generated_at: payload.generatedAt,
        memory_date: payload.memoryDate,
        source_fingerprint: payload.sourceFingerprint,
        period: payload.period,
        knowledge_score: payload.knowledgeScore,
        scientific_score: payload.scientificScore,
        validated_theories: payload.validatedTheories,
        strengthening_hypotheses: payload.strengtheningHypotheses,
        observed_patterns: payload.observedPatterns,
        business_conclusions: payload.businessConclusions,
        correlations: payload.correlations,
        limitations: payload.limitations,
        quality: payload.quality,
        version: payload.version,
      })
      .select("*")
      .single();
    if (error) {
      // 23505 = unique_violation → corrida com outra chamada idêntica.
      if ((error as { code?: string }).code === "23505") {
        const again = await this.findByFingerprint(payload);
        return { record: again, alreadyExists: true };
      }
      return { record: null, alreadyExists: false };
    }
    return { record: data ? mapRow(data as RawRow) : null, alreadyExists: false };
  }

  async latest(period?: ScientificMemoryPeriod): Promise<ScientificMemoryRecord | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (this.supabase as any)
      .from("scientific_memory")
      .select("*")
      .eq("company_id", this.companyId);
    if (period) query = query.eq("period", period);
    const { data, error } = await query
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return mapRow(data as RawRow);
  }

  async previous(
    beforeIso: string,
    period: ScientificMemoryPeriod,
    version: string,
  ): Promise<ScientificMemoryRecord | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (this.supabase as any)
      .from("scientific_memory")
      .select("*")
      .eq("company_id", this.companyId)
      .eq("period", period)
      .eq("version", version)
      .lt("generated_at", beforeIso)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return mapRow(data as RawRow);
  }

  async timeline(period?: ScientificMemoryPeriod): Promise<ScientificMemoryTimelineItem[]> {
    const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (this.supabase as any)
      .from("scientific_memory")
      .select("id,generated_at,period,knowledge_score,scientific_score,quality,version")
      .eq("company_id", this.companyId)
      .gte("generated_at", since);
    if (period) query = query.eq("period", period);
    const { data, error } = await query.order("generated_at", { ascending: false }).limit(730);
    if (error || !Array.isArray(data)) return [];
    return (data as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      generatedAt: String(r.generated_at),
      period: String(r.period) as ScientificMemoryPeriod,
      knowledgeScore: asNumber(r.knowledge_score as number),
      scientificScore: asNumber(r.scientific_score as number),
      quality: asObject<MemoryQuality>(r.quality, emptyQuality),
      version: String(r.version),
    }));
  }
}
