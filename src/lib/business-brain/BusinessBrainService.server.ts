// ============================================================================
// BusinessBrainService — Orquestra Analyzer + Aggregator + Patterns + Knowledge
// e devolve o snapshot completo. READ-ONLY. Nenhum efeito colateral.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { BusinessBrainAnalyzer } from "./BusinessBrainAnalyzer.server";
import { BusinessBrainAggregator } from "./BusinessBrainAggregator.server";
import { BusinessBrainPatterns } from "./BusinessBrainPatterns.server";
import { BusinessBrainKnowledge } from "./BusinessBrainKnowledge.server";
import { BRAIN_VERSION, type BrainPeriod, type BusinessBrainSnapshot } from "./BusinessBrainTypes";

export class BusinessBrainService {
  static async build(
    supabase: SupabaseClient<Database>,
    companyId: string,
    period: BrainPeriod,
  ): Promise<BusinessBrainSnapshot> {
    const analyzer = new BusinessBrainAnalyzer(supabase, companyId);
    const raw = await analyzer.collect(period);
    const generatedAt = new Date().toISOString();

    const metrics = BusinessBrainAggregator.build(raw.facts);
    const patterns = BusinessBrainPatterns.build(raw.facts, metrics);
    const knowledge = BusinessBrainKnowledge.buildKnowledge(
      metrics,
      raw.executiveSnapshot,
      period,
      generatedAt,
    );
    const trends = BusinessBrainKnowledge.buildTrends(metrics, raw.knowledgeRecent, period);

    return {
      generatedAt,
      brainVersion: BRAIN_VERSION,
      period,
      sample: {
        conversationFacts: raw.facts.length,
        knowledgeSnapshots: raw.knowledgeRecent.length,
        hasExecutiveSnapshot: raw.executiveSnapshot !== null,
      },
      metrics,
      patterns,
      knowledge,
      trends,
    };
  }
}
