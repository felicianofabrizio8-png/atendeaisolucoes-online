// ============================================================================
// ScientificKnowledgeService — Orquestra Observation → Hypothesis → Evidence
// → Theory → Validation → Knowledge. READ-ONLY. Determinístico. Sem LLM.
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
  SCIENCE_THRESHOLDS,
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
    const learning = await new BusinessLearningAgent({ supabase, companyId }).snapshot(period);

    let knowledgeTimeline: ExecutiveKnowledgeRecord[] = [];
    try {
      const repo = new ExecutiveKnowledgeRepository(supabase, companyId);
      knowledgeTimeline = await repo.timeline(period as ExecutivePeriod, 24);
    } catch {
      knowledgeTimeline = [];
    }

    // Fase 6: histórico = dias distintos (nunca registros da mesma execução).
    const distinctSnapshotDays = new Set(
      knowledgeTimeline.map((r) => (r.createdAt || "").slice(0, 10)).filter(Boolean),
    ).size;

    // Fase 10: gate de produtos. Sem sinal upstream de cobertura de products_json
    // aqui, mantemos productsReady=false para evitar falso conhecimento até que
    // uma fonte confiável indique cobertura ≥ MIN_PRODUCTS_COVERAGE.
    const productsReady = false;

    const observations = ScientificObservationEngine.build({
      brain,
      learning,
      knowledgeTimeline,
      period,
      now,
      productsReady,
    });

    const hypothesesInitial = ScientificHypothesisEngine.build(observations);
    const evidence = ScientificEvidenceEngine.build({
      hypotheses: hypothesesInitial,
      observations,
      brain,
      learning,
    });
    const { hypotheses, theories, validatedKnowledge } =
      ScientificValidationEngine.run({
        hypotheses: hypothesesInitial,
        evidence,
        distinctSnapshotDays,
        now,
      });

    // silence unused threshold import warning while keeping it exported for tests
    void SCIENCE_THRESHOLDS;

    return {
      generatedAt: now,
      scientificVersion: SCIENTIFIC_VERSION,
      period,
      sample: {
        observations: observations.length,
        hypotheses: hypotheses.length,
        evidence: evidence.length,
        theories: theories.length,
        validatedKnowledge: validatedKnowledge.length,
        brainPatterns: brain.patterns.length,
        brainKnowledge: brain.knowledge.length,
        brainTrends: brain.trends.length,
        learningHypotheses: learning.hypotheses.length,
        learningEvolutions: learning.evolution.length,
        knowledgeTimeline: knowledgeTimeline.length,
        distinctSnapshotDays,
        productsReady,
      },
      observations,
      hypotheses,
      evidence,
      theories,
      validatedKnowledge,
    };
  }
}
