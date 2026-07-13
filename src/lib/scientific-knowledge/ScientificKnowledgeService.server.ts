// ============================================================================
// ScientificKnowledgeService — Orquestra Observation → Hypothesis → Evidence
// → Validation → Knowledge. READ-ONLY. Determinístico. Sem LLM.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { BusinessBrainAgent } from "@/lib/business-brain/BusinessBrainAgent.server";
import { BusinessLearningAgent } from "@/lib/business-learning/BusinessLearningAgent.server";
import { ExecutiveKnowledgeRepository } from "@/lib/executive-knowledge/ExecutiveKnowledgeRepository.server";
import type { ExecutiveKnowledgeRecord } from "@/lib/executive-knowledge/ExecutiveKnowledgeTypes";
import type { ExecutivePeriod } from "@/lib/executive-ai/types";
import {
  SCIENTIFIC_VERSION,
  type ScientificKnowledgeSnapshot,
  type SciencePeriod,
} from "./ScientificKnowledgeTypes";
import { ScientificObservationEngine } from "./ScientificObservationEngine.server";
import { ScientificHypothesisEngine } from "./ScientificHypothesisEngine.server";
import { ScientificEvidenceEngine } from "./ScientificEvidenceEngine.server";
import { ScientificValidationEngine } from "./ScientificValidationEngine.server";

export class ScientificKnowledgeService {
  static async build(
    supabase: SupabaseClient<Database>,
    companyId: string,
    period: SciencePeriod,
  ): Promise<ScientificKnowledgeSnapshot> {
    const now = new Date().toISOString();

    const brain = await new BusinessBrainAgent({ supabase, companyId }).snapshot(period);
    const learning = await new BusinessLearningAgent({ supabase, companyId }).snapshot(
      period,
    );

    let knowledgeTimeline: ExecutiveKnowledgeRecord[] = [];
    try {
      const repo = new ExecutiveKnowledgeRepository(supabase, companyId);
      knowledgeTimeline = await repo.timeline(period as ExecutivePeriod, 24);
    } catch {
      knowledgeTimeline = [];
    }

    const observations = ScientificObservationEngine.build({
      brain,
      learning,
      knowledgeTimeline,
      period,
      now,
    });

    const hypothesesInitial = ScientificHypothesisEngine.build(observations);
    const evidence = ScientificEvidenceEngine.build({
      hypotheses: hypothesesInitial,
      observations,
      brain,
      learning,
    });
    const { hypotheses, validatedKnowledge } = ScientificValidationEngine.run({
      hypotheses: hypothesesInitial,
      evidence,
      knowledgeTimelineSize: knowledgeTimeline.length,
      now,
    });

    return {
      generatedAt: now,
      scientificVersion: SCIENTIFIC_VERSION,
      period,
      sample: {
        observations: observations.length,
        hypotheses: hypotheses.length,
        evidence: evidence.length,
        validatedKnowledge: validatedKnowledge.length,
        brainPatterns: brain.patterns.length,
        brainKnowledge: brain.knowledge.length,
        brainTrends: brain.trends.length,
        learningHypotheses: learning.hypotheses.length,
        learningEvolutions: learning.evolution.length,
        knowledgeTimeline: knowledgeTimeline.length,
      },
      observations,
      hypotheses,
      evidence,
      validatedKnowledge,
    };
  }
}
