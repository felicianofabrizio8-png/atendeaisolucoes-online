// ============================================================================
// Scientific Memory — Repository (Fase 4)
// READ + INSERT only. RLS admin-only já cuida da autorização.
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

// Row shape flexível: a tabela é nova e pode ainda não estar tipada em Database.
interface RawRow {
  id: string;
  company_id: string;
  generated_at: string;
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

function mapRow(row: RawRow): ScientificMemoryRecord {
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
  return {
    id: row.id,
    companyId: row.company_id,
    generatedAt: row.generated_at,
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

export class ScientificMemoryRepository {
  private readonly supabase: SupabaseClient<Database>;
  private readonly companyId: string;

  constructor(supabase: SupabaseClient<Database>, companyId: string) {
    this.supabase = supabase;
    this.companyId = companyId;
  }

  async insert(payload: ScientificMemoryInsert): Promise<ScientificMemoryRecord | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.supabase as any;
    const { data, error } = await client
      .from("scientific_memory")
      .insert({
        company_id: this.companyId,
        generated_at: payload.generatedAt,
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
    if (error || !data) return null;
    return mapRow(data as RawRow);
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
  ): Promise<ScientificMemoryRecord | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (this.supabase as any)
      .from("scientific_memory")
      .select("*")
      .eq("company_id", this.companyId)
      .eq("period", period)
      .lt("generated_at", beforeIso)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return mapRow(data as RawRow);
  }

  /** Últimos 365 dias (limite protetor de 730 linhas). */
  async timeline(period?: ScientificMemoryPeriod): Promise<ScientificMemoryTimelineItem[]> {
    const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (this.supabase as any)
      .from("scientific_memory")
      .select(
        "id,generated_at,period,knowledge_score,scientific_score,quality,version",
      )
      .eq("company_id", this.companyId)
      .gte("generated_at", since);
    if (period) query = query.eq("period", period);
    const { data, error } = await query
      .order("generated_at", { ascending: false })
      .limit(730);
    if (error || !Array.isArray(data)) return [];
    return (data as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      generatedAt: String(r.generated_at),
      period: String(r.period) as ScientificMemoryPeriod,
      knowledgeScore: asNumber(r.knowledge_score as number),
      scientificScore: asNumber(r.scientific_score as number),
      quality: asObject<MemoryQuality>(r.quality, {
        observationsCount: 0,
        hypothesesCount: 0,
        evidenceCount: 0,
        theoriesCount: 0,
        validatedKnowledgeCount: 0,
        distinctSnapshotDays: 0,
        brainPatterns: 0,
        brainKnowledge: 0,
        avgConfidence: 0,
      }),
      version: String(r.version),
    }));
  }
}
