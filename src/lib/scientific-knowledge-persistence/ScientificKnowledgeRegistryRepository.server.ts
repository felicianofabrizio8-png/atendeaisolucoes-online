// ============================================================================
// ScientificKnowledgeRegistryRepository — Upsert de conhecimento validado
// e candidatos (teorias com repetição temporal ainda não consolidada).
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  ScientificKnowledge,
  ScientificTheory,
} from "@/lib/scientific-knowledge/ScientificKnowledgeTypes";

export interface KnowledgeRegistryRow {
  id: string;
  knowledge_key: string;
  status: string;
  confidence: number;
  scientific_score: number;
  distinct_snapshot_days: number;
  last_confirmed_day: string | null;
  validated_since: string | null;
  contradiction_count: number;
}

export interface KnowledgePlan {
  toInsert: number;
  toUpdate: number;
  candidates: number;
  validated: number;
  historical: number;
  deprecated: number;
  contradictionsIncrement: number;
}

export class ScientificKnowledgeRegistryRepository {
  constructor(private readonly admin: SupabaseClient<Database>) {}

  async listByKeys(
    companyId: string,
    keys: string[],
  ): Promise<Map<string, KnowledgeRegistryRow>> {
    if (keys.length === 0) return new Map();
    const { data, error } = await this.admin
      .from("scientific_knowledge_registry")
      .select(
        "id, knowledge_key, status, confidence, scientific_score, distinct_snapshot_days, last_confirmed_day, validated_since, contradiction_count",
      )
      .eq("company_id", companyId)
      .in("knowledge_key", keys);
    if (error) throw error;
    const map = new Map<string, KnowledgeRegistryRow>();
    for (const r of (data ?? []) as KnowledgeRegistryRow[]) {
      map.set(r.knowledge_key, r);
    }
    return map;
  }

  /** Merge theories (candidates) + validatedKnowledge into a unified upsert list. */
  buildEntries(
    theories: ScientificTheory[],
    validated: ScientificKnowledge[],
  ): { key: string; source: "theory" | "validated"; theory?: ScientificTheory; knowledge?: ScientificKnowledge }[] {
    const entries: {
      key: string;
      source: "theory" | "validated";
      theory?: ScientificTheory;
      knowledge?: ScientificKnowledge;
    }[] = [];
    // validated first: takes precedence when the same provenanceKey appears in both
    const seen = new Set<string>();
    for (const k of validated) {
      entries.push({ key: k.provenanceKey, source: "validated", knowledge: k });
      seen.add(k.provenanceKey);
    }
    for (const t of theories) {
      if (seen.has(t.provenanceKey)) continue;
      entries.push({ key: t.provenanceKey, source: "theory", theory: t });
    }
    return entries;
  }

  planApply(
    entries: ReturnType<ScientificKnowledgeRegistryRepository["buildEntries"]>,
    existing: Map<string, KnowledgeRegistryRow>,
  ): KnowledgePlan {
    const plan: KnowledgePlan = {
      toInsert: 0,
      toUpdate: 0,
      candidates: 0,
      validated: 0,
      historical: 0,
      deprecated: 0,
      contradictionsIncrement: 0,
    };
    for (const e of entries) {
      const nextStatus =
        e.source === "validated" ? (e.knowledge!.status) : "candidate";
      if (nextStatus === "candidate") plan.candidates += 1;
      if (nextStatus === "validated") plan.validated += 1;
      if (nextStatus === "historical") plan.historical += 1;
      if (nextStatus === "deprecated") plan.deprecated += 1;
      const cur = existing.get(e.key);
      if (!cur) {
        plan.toInsert += 1;
      } else {
        plan.toUpdate += 1;
        const nextConf =
          e.source === "validated" ? e.knowledge!.confidence : 0.5;
        if (nextConf + 0.2 < cur.confidence) plan.contradictionsIncrement += 1;
      }
    }
    return plan;
  }

  async apply(
    companyId: string,
    entries: ReturnType<ScientificKnowledgeRegistryRepository["buildEntries"]>,
    existing: Map<string, KnowledgeRegistryRow>,
    snapshotDay: string,
    snapshotGeneratedAt: string,
  ): Promise<void> {
    const inserts: Database["public"]["Tables"]["scientific_knowledge_registry"]["Insert"][] =
      [];
    for (const e of entries) {
      const isValidated = e.source === "validated";
      const status = isValidated ? e.knowledge!.status : "candidate";
      const title = isValidated ? e.knowledge!.title : e.theory!.title;
      const category = isValidated ? e.knowledge!.category : e.theory!.category;
      const summary = isValidated
        ? e.knowledge!.summary
        : `Teoria em observação: ${e.theory!.title}`;
      const confidence = isValidated ? e.knowledge!.confidence : 0.5;
      const score = isValidated
        ? e.knowledge!.scientificScore
        : Math.min(1, e.theory!.distinctDays / 5);
      const cur = existing.get(e.key);
      if (!cur) {
        inserts.push({
          company_id: companyId,
          knowledge_key: e.key,
          category,
          title,
          summary,
          status,
          confidence,
          scientific_score: score,
          validated_since:
            status === "validated" ? snapshotGeneratedAt : null,
          last_confirmed_at: snapshotGeneratedAt,
          last_confirmed_day: snapshotDay,
          distinct_snapshot_days: 1,
          contradiction_count: 0,
          provenance_keys_json: [e.key] as never,
          evidence_summary_json: {} as never,
        });
        continue;
      }
      const isNewDay = cur.last_confirmed_day !== snapshotDay;
      const contradiction = confidence + 0.2 < cur.confidence ? 1 : 0;
      const nextValidatedSince =
        status === "validated" && !cur.validated_since
          ? snapshotGeneratedAt
          : cur.validated_since;
      const { error } = await this.admin
        .from("scientific_knowledge_registry")
        .update({
          category,
          title,
          summary,
          status,
          confidence,
          scientific_score: score,
          validated_since: nextValidatedSince,
          last_confirmed_at: snapshotGeneratedAt,
          last_confirmed_day: snapshotDay,
          distinct_snapshot_days: isNewDay
            ? cur.distinct_snapshot_days + 1
            : cur.distinct_snapshot_days,
          contradiction_count: cur.contradiction_count + contradiction,
        })
        .eq("id", cur.id);
      if (error) throw error;
    }
    if (inserts.length > 0) {
      const { error } = await this.admin
        .from("scientific_knowledge_registry")
        .insert(inserts);
      if (error) throw error;
    }
  }
}
