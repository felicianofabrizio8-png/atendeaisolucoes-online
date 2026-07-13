// ============================================================================
// ScientificSnapshotRepository — Persistência imutável de snapshots científicos.
// Uso apenas server-side. Requer supabaseAdmin (service role) porque as
// policies de RLS não expõem escrita. O tenant é sempre derivado do JWT
// no endpoint, nunca aceito livre de request.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { SciencePeriod } from "@/lib/scientific-knowledge/ScientificKnowledgeTypes";

export interface SnapshotInsertInput {
  companyId: string;
  period: SciencePeriod;
  engineVersion: string;
  snapshotDate: string;
  snapshotGeneratedAt: string;
  sourceFingerprint: string;
  observations: unknown[];
  hypotheses: unknown[];
  evidence: unknown[];
  theories: unknown[];
  validatedKnowledge: unknown[];
  quality: Record<string, unknown>;
}

export class ScientificSnapshotRepository {
  constructor(private readonly admin: SupabaseClient<Database>) {}

  async findByFingerprint(
    companyId: string,
    period: SciencePeriod,
    engineVersion: string,
    snapshotDate: string,
    sourceFingerprint: string,
  ): Promise<{ id: string } | null> {
    const { data, error } = await this.admin
      .from("scientific_knowledge_snapshots")
      .select("id")
      .eq("company_id", companyId)
      .eq("period", period)
      .eq("engine_version", engineVersion)
      .eq("snapshot_date", snapshotDate)
      .eq("source_fingerprint", sourceFingerprint)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  }

  async insert(input: SnapshotInsertInput): Promise<string> {
    const { data, error } = await this.admin
      .from("scientific_knowledge_snapshots")
      .insert({
        company_id: input.companyId,
        period: input.period,
        engine_version: input.engineVersion,
        snapshot_date: input.snapshotDate,
        snapshot_generated_at: input.snapshotGeneratedAt,
        source_fingerprint: input.sourceFingerprint,
        observations_json: input.observations as never,
        hypotheses_json: input.hypotheses as never,
        evidence_json: input.evidence as never,
        theories_json: input.theories as never,
        validated_knowledge_json: input.validatedKnowledge as never,
        quality_json: input.quality as never,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  async timeline(
    companyId: string,
    period: SciencePeriod,
    limit: number,
  ): Promise<
    {
      snapshot_date: string;
      engine_version: string;
      quality_json: Record<string, unknown>;
      created_at: string;
    }[]
  > {
    const { data, error } = await this.admin
      .from("scientific_knowledge_snapshots")
      .select("snapshot_date, engine_version, quality_json, created_at")
      .eq("company_id", companyId)
      .eq("period", period)
      .order("snapshot_date", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as never;
  }
}
