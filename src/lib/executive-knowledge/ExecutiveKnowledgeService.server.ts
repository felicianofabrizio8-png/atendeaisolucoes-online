// ============================================================================
// ExecutiveKnowledgeService — Orquestrador do módulo Executive Knowledge.
// Recebe um Executive Snapshot e:
//   1. Persiste um novo registro APENAS se snapshot_generated_at for inédito.
//   2. Devolve o registro atual + o anterior + a comparação determinística.
// Nenhuma escrita em outras tabelas. Nenhuma consulta fora de executive_knowledge.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ExecutiveDashboardBundle } from "@/lib/executive-ai/types";
import { ExecutiveKnowledgeBuilder } from "./ExecutiveKnowledgeBuilder.server";
import { ExecutiveKnowledgeComparer } from "./ExecutiveKnowledgeComparer.server";
import { ExecutiveKnowledgeRepository } from "./ExecutiveKnowledgeRepository.server";
import type {
  ExecutiveKnowledgeRecord,
  KnowledgeComparison,
} from "./ExecutiveKnowledgeTypes";

export interface KnowledgeIngestResult {
  current: ExecutiveKnowledgeRecord;
  previous: ExecutiveKnowledgeRecord | null;
  comparison: KnowledgeComparison;
  createdNew: boolean;
}

export class ExecutiveKnowledgeService {
  static async ingestSnapshot(
    supabase: SupabaseClient<Database>,
    companyId: string,
    bundle: ExecutiveDashboardBundle,
  ): Promise<KnowledgeIngestResult> {
    const repo = new ExecutiveKnowledgeRepository(supabase, companyId);

    // Deduplicação por snapshot_generated_at + period.
    const existing = await repo.findBySnapshot(bundle.period, bundle.generatedAt);

    let current: ExecutiveKnowledgeRecord;
    let createdNew = false;

    if (existing) {
      current = existing;
    } else {
      const built = ExecutiveKnowledgeBuilder.build(bundle);
      const inserted = await repo.insert({
        period: bundle.period,
        snapshotGeneratedAt: bundle.generatedAt,
        knowledgeVersion: built.knowledgeVersion,
        facts: built.facts,
        highlights: built.highlights,
        recommendations: built.recommendations,
      });
      if (inserted) {
        current = inserted;
        createdNew = true;
      } else {
        // Corrida: outro processo inseriu simultaneamente. Recarrega.
        const reloaded = await repo.findBySnapshot(bundle.period, bundle.generatedAt);
        if (!reloaded) throw new Error("knowledge_ingest_race");
        current = reloaded;
      }
    }

    const previous = await repo.previousBefore(bundle.period, current.snapshotGeneratedAt);
    const comparison = ExecutiveKnowledgeComparer.compare(current, previous);

    return { current, previous, comparison, createdNew };
  }

  static async latest(
    supabase: SupabaseClient<Database>,
    companyId: string,
    period: ExecutiveDashboardBundle["period"],
  ): Promise<ExecutiveKnowledgeRecord | null> {
    const repo = new ExecutiveKnowledgeRepository(supabase, companyId);
    return repo.latest(period);
  }

  static async timeline(
    supabase: SupabaseClient<Database>,
    companyId: string,
    period: ExecutiveDashboardBundle["period"],
    limit = 30,
  ): Promise<ExecutiveKnowledgeRecord[]> {
    const repo = new ExecutiveKnowledgeRepository(supabase, companyId);
    return repo.timeline(period, limit);
  }
}
