// ============================================================================
// ExecutiveKnowledgeRepository — Acesso à tabela `executive_knowledge`.
// Usa o cliente Supabase AUTENTICADO do usuário (RLS aplicada). Nunca usa
// service_role. Todas as chamadas ficam restritas à empresa do próprio usuário
// e ao papel admin, conforme políticas RLS.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  ExecutiveKnowledgeRecord,
  KnowledgeFacts,
  KnowledgeHighlight,
  KnowledgeRecommendation,
} from "./ExecutiveKnowledgeTypes";
import type { ExecutivePeriod } from "@/lib/executive-ai/types";

// A tabela é nova; até os types serem regenerados, tipamos internamente para
// evitar `any`. As colunas correspondem exatamente ao schema da migração.
interface RawRow {
  id: string;
  company_id: string;
  snapshot_generated_at: string;
  period: string;
  knowledge_version: number;
  facts_json: unknown;
  highlights_json: unknown;
  recommendations_json: unknown;
  created_at: string;
}

function mapRow(row: RawRow): ExecutiveKnowledgeRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    snapshotGeneratedAt: row.snapshot_generated_at,
    period: row.period as ExecutivePeriod,
    knowledgeVersion: row.knowledge_version,
    facts: row.facts_json as KnowledgeFacts,
    highlights: (row.highlights_json as KnowledgeHighlight[]) ?? [],
    recommendations: (row.recommendations_json as KnowledgeRecommendation[]) ?? [],
    createdAt: row.created_at,
  };
}

export class ExecutiveKnowledgeRepository {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly companyId: string,
  ) {}

  private table() {
    // Cast pontual: até a regeneração dos types, a tabela não aparece no
    // Database gerado. RLS continua sendo o mecanismo de segurança real.
    return (this.supabase as unknown as SupabaseClient).from("executive_knowledge");
  }

  async findBySnapshot(
    period: ExecutivePeriod,
    snapshotGeneratedAt: string,
  ): Promise<ExecutiveKnowledgeRecord | null> {
    const { data, error } = await this.table()
      .select("*")
      .eq("company_id", this.companyId)
      .eq("period", period)
      .eq("snapshot_generated_at", snapshotGeneratedAt)
      .maybeSingle();
    if (error) throw new Error(`knowledge_read_failed:${error.code ?? "unknown"}`);
    return data ? mapRow(data as RawRow) : null;
  }

  async latest(period: ExecutivePeriod): Promise<ExecutiveKnowledgeRecord | null> {
    const { data, error } = await this.table()
      .select("*")
      .eq("company_id", this.companyId)
      .eq("period", period)
      .order("snapshot_generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`knowledge_read_failed:${error.code ?? "unknown"}`);
    return data ? mapRow(data as RawRow) : null;
  }

  async previousBefore(
    period: ExecutivePeriod,
    snapshotGeneratedAt: string,
  ): Promise<ExecutiveKnowledgeRecord | null> {
    const { data, error } = await this.table()
      .select("*")
      .eq("company_id", this.companyId)
      .eq("period", period)
      .lt("snapshot_generated_at", snapshotGeneratedAt)
      .order("snapshot_generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`knowledge_read_failed:${error.code ?? "unknown"}`);
    return data ? mapRow(data as RawRow) : null;
  }

  async timeline(period: ExecutivePeriod, limit = 30): Promise<ExecutiveKnowledgeRecord[]> {
    const { data, error } = await this.table()
      .select("*")
      .eq("company_id", this.companyId)
      .eq("period", period)
      .order("snapshot_generated_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`knowledge_read_failed:${error.code ?? "unknown"}`);
    return (data ?? []).map((r) => mapRow(r as RawRow));
  }

  async insert(input: {
    period: ExecutivePeriod;
    snapshotGeneratedAt: string;
    knowledgeVersion: number;
    facts: KnowledgeFacts;
    highlights: KnowledgeHighlight[];
    recommendations: KnowledgeRecommendation[];
  }): Promise<ExecutiveKnowledgeRecord | null> {
    const row = {
      company_id: this.companyId,
      period: input.period,
      snapshot_generated_at: input.snapshotGeneratedAt,
      knowledge_version: input.knowledgeVersion,
      facts_json: input.facts,
      highlights_json: input.highlights,
      recommendations_json: input.recommendations,
    };
    const { data, error } = await this.table().insert(row).select("*").maybeSingle();
    if (error) {
      // 23505 = unique_violation: outro processo já inseriu esse snapshot.
      if (error.code === "23505") return null;
      throw new Error(`knowledge_insert_failed:${error.code ?? "unknown"}`);
    }
    return data ? mapRow(data as RawRow) : null;
  }
}
