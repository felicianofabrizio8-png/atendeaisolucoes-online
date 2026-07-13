// ============================================================================
// BusinessLearningAnalyzer — Coleta READ-ONLY das fontes permitidas.
// Fontes: Business Brain (via BusinessBrainAgent) + Executive Knowledge (RLS).
// NUNCA acessa: CRM, leads, messages, conversations, quotes, follow_ups,
// campaigns, conversation_facts, whatsapp, instagram, facebook.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { BusinessBrainAgent } from "@/lib/business-brain/BusinessBrainAgent.server";
import type { BusinessBrainSnapshot } from "@/lib/business-brain/BusinessBrainTypes";
import type { ExecutiveKnowledgeRecord } from "@/lib/executive-knowledge/ExecutiveKnowledgeTypes";
import { ExecutiveKnowledgeRepository } from "@/lib/executive-knowledge/ExecutiveKnowledgeRepository.server";
import type { ExecutivePeriod } from "@/lib/executive-ai/types";
import type { LearningPeriod } from "./BusinessLearningTypes";

export interface LearningRawDataset {
  period: LearningPeriod;
  now: string;
  brainSnapshot: BusinessBrainSnapshot;
  knowledgeTimeline: ExecutiveKnowledgeRecord[];
}

export class BusinessLearningAnalyzer {
  constructor(
    private readonly supabase: SupabaseClient<Database>,
    private readonly companyId: string,
  ) {}

  async collect(period: LearningPeriod): Promise<LearningRawDataset> {
    const brainAgent = new BusinessBrainAgent({
      supabase: this.supabase,
      companyId: this.companyId,
    });
    const brainSnapshot = await brainAgent.snapshot(period);

    const knowledgeRepo = new ExecutiveKnowledgeRepository(this.supabase, this.companyId);
    let knowledgeTimeline: ExecutiveKnowledgeRecord[] = [];
    try {
      knowledgeTimeline = await knowledgeRepo.timeline(period as ExecutivePeriod, 24);
    } catch {
      knowledgeTimeline = [];
    }

    return {
      period,
      now: new Date().toISOString(),
      brainSnapshot,
      knowledgeTimeline,
    };
  }
}
