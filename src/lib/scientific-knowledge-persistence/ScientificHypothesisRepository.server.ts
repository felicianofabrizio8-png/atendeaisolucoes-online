// ============================================================================
// ScientificHypothesisRepository — Upsert controlado no registry de hipóteses.
// - hypothesis_key = provenance_key (linhagem determinística)
// - distinct_snapshot_days só incrementa em dia novo
// - firstObserved preservado; lastObserved atualizado
// - status calculado pelo Validation Engine (nunca promovido manualmente)
// - contradições incrementadas quando confidence cai bruscamente
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  ScientificHypothesis,
} from "@/lib/scientific-knowledge/ScientificKnowledgeTypes";

export interface HypothesisRegistryRow {
  id: string;
  hypothesis_key: string;
  status: string;
  confidence: number;
  scientific_score: number;
  occurrence_count: number;
  distinct_snapshot_days: number;
  first_observed_at: string;
  last_observed_at: string;
  last_observed_day: string;
  contradiction_count: number;
}

export interface HypothesisApplyPlan {
  toInsert: number;
  toUpdate: number;
  sameDay: number;
  contradictionsIncrement: number;
}

export class ScientificHypothesisRepository {
  constructor(private readonly admin: SupabaseClient<Database>) {}

  async listByKeys(
    companyId: string,
    keys: string[],
  ): Promise<Map<string, HypothesisRegistryRow>> {
    if (keys.length === 0) return new Map();
    const { data, error } = await this.admin
      .from("scientific_hypothesis_registry")
      .select(
        "id, hypothesis_key, status, confidence, scientific_score, occurrence_count, distinct_snapshot_days, first_observed_at, last_observed_at, last_observed_day, contradiction_count",
      )
      .eq("company_id", companyId)
      .in("hypothesis_key", keys);
    if (error) throw error;
    const map = new Map<string, HypothesisRegistryRow>();
    for (const r of (data ?? []) as HypothesisRegistryRow[]) {
      map.set(r.hypothesis_key, r);
    }
    return map;
  }

  /** Compute plan without writing. */
  planApply(
    hypotheses: ScientificHypothesis[],
    existing: Map<string, HypothesisRegistryRow>,
    snapshotDay: string,
  ): HypothesisApplyPlan {
    let toInsert = 0;
    let toUpdate = 0;
    let sameDay = 0;
    let contradictionsIncrement = 0;
    for (const h of hypotheses) {
      const cur = existing.get(h.provenanceKey);
      if (!cur) {
        toInsert += 1;
        continue;
      }
      toUpdate += 1;
      if (cur.last_observed_day === snapshotDay) sameDay += 1;
      if (h.confidence + 0.2 < cur.confidence) contradictionsIncrement += 1;
    }
    return { toInsert, toUpdate, sameDay, contradictionsIncrement };
  }

  async apply(
    companyId: string,
    hypotheses: ScientificHypothesis[],
    existing: Map<string, HypothesisRegistryRow>,
    snapshotDay: string,
    snapshotGeneratedAt: string,
    scientificScoreByHypothesis: Map<string, number>,
    sourceFingerprint: string,
  ): Promise<void> {
    const inserts: Database["public"]["Tables"]["scientific_hypothesis_registry"]["Insert"][] =
      [];
    for (const h of hypotheses) {
      const cur = existing.get(h.provenanceKey);
      const score = scientificScoreByHypothesis.get(h.id) ?? 0;
      if (!cur) {
        inserts.push({
          company_id: companyId,
          hypothesis_key: h.provenanceKey,
          category: h.category,
          title: h.title,
          description: h.description,
          status: h.status,
          confidence: h.confidence,
          scientific_score: score,
          occurrence_count: h.occurrences,
          distinct_snapshot_days: 1,
          first_observed_at: snapshotGeneratedAt,
          last_observed_at: snapshotGeneratedAt,
          last_observed_day: snapshotDay,
          provenance_key: h.provenanceKey,
          source_fingerprint: sourceFingerprint,
          contradiction_count: 0,
          supporting_evidence_json: {
            count: h.supportingEvidence.length,
          } as never,
        });
        continue;
      }
      const isNewDay = cur.last_observed_day !== snapshotDay;
      const contradiction = h.confidence + 0.2 < cur.confidence ? 1 : 0;
      const { error } = await this.admin
        .from("scientific_hypothesis_registry")
        .update({
          status: h.status,
          confidence: h.confidence,
          scientific_score: score,
          occurrence_count: h.occurrences,
          distinct_snapshot_days: isNewDay
            ? cur.distinct_snapshot_days + 1
            : cur.distinct_snapshot_days,
          last_observed_at: snapshotGeneratedAt,
          last_observed_day: snapshotDay,
          contradiction_count: cur.contradiction_count + contradiction,
          supporting_evidence_json: {
            count: h.supportingEvidence.length,
          } as never,
        })
        .eq("id", cur.id);
      if (error) throw error;
    }
    if (inserts.length > 0) {
      const { error } = await this.admin
        .from("scientific_hypothesis_registry")
        .insert(inserts);
      if (error) throw error;
    }
  }
}
