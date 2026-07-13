// ============================================================================
// Scientific Memory — Service (Fase 4)
// Orquestra ciência + brain → build → persiste → calcula evolução.
// READ-ONLY para o mundo externo. INSERT único por chamada `persist`.
// Nenhum LLM, nenhum consumidor operacional.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { BusinessBrainAgent } from "@/lib/business-brain/BusinessBrainAgent.server";
import { ScientificKnowledgeAgent } from "@/lib/scientific-knowledge/ScientificKnowledgeAgent.server";
import { ScientificMemoryBuilder } from "./ScientificMemoryBuilder.server";
import { ScientificMemoryRepository } from "./ScientificMemoryRepository.server";
import type {
  ScientificMemoryEvolution,
  ScientificMemoryPeriod,
  ScientificMemoryRecord,
  ScientificMemoryTimelineItem,
} from "./ScientificMemoryTypes";

export interface PersistResult {
  saved: ScientificMemoryRecord | null;
  evolution: ScientificMemoryEvolution;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

function computeEvolution(
  current: Pick<
    ScientificMemoryRecord,
    | "knowledgeScore"
    | "scientificScore"
    | "quality"
    | "validatedTheories"
    | "strengtheningHypotheses"
    | "observedPatterns"
    | "businessConclusions"
  >,
  previous: ScientificMemoryRecord | null,
): ScientificMemoryEvolution {
  if (!previous) {
    return {
      hasPrevious: false,
      previousGeneratedAt: null,
      knowledgeEvolution: 0,
      scientificEvolution: 0,
      businessEvolution: 0,
      confidenceEvolution: 0,
      validatedTheoriesDelta: 0,
      strengtheningHypothesesDelta: 0,
      observedPatternsDelta: 0,
    };
  }
  const confDelta =
    clamp01(current.quality.avgConfidence) -
    clamp01(previous.quality.avgConfidence);
  const businessDelta =
    (current.businessConclusions.length - previous.businessConclusions.length) *
      0.5 +
    confDelta;
  return {
    hasPrevious: true,
    previousGeneratedAt: previous.generatedAt,
    knowledgeEvolution: current.knowledgeScore - previous.knowledgeScore,
    scientificEvolution: current.scientificScore - previous.scientificScore,
    businessEvolution: businessDelta,
    confidenceEvolution: confDelta,
    validatedTheoriesDelta:
      current.validatedTheories.length - previous.validatedTheories.length,
    strengtheningHypothesesDelta:
      current.strengtheningHypotheses.length -
      previous.strengtheningHypotheses.length,
    observedPatternsDelta:
      current.observedPatterns.length - previous.observedPatterns.length,
  };
}

export class ScientificMemoryService {
  private readonly supabase: SupabaseClient<Database>;
  private readonly companyId: string;
  private readonly repo: ScientificMemoryRepository;

  constructor(supabase: SupabaseClient<Database>, companyId: string) {
    this.supabase = supabase;
    this.companyId = companyId;
    this.repo = new ScientificMemoryRepository(supabase, companyId);
  }

  async persist(period: ScientificMemoryPeriod = "30d"): Promise<PersistResult> {
    const science = await new ScientificKnowledgeAgent({
      supabase: this.supabase,
      companyId: this.companyId,
    }).snapshot(period);

    const brain = await new BusinessBrainAgent({
      supabase: this.supabase,
      companyId: this.companyId,
    }).snapshot(period);

    const now = new Date().toISOString();
    const payload = ScientificMemoryBuilder.build({ period, science, brain, now });

    const previous = await this.repo.previous(now, period);
    const saved = await this.repo.insert(payload);
    const currentForEvo = saved ?? {
      ...payload,
      id: "",
      companyId: this.companyId,
      createdAt: now,
    };
    const evolution = computeEvolution(currentForEvo, previous);

    return { saved, evolution };
  }

  async latest(
    period?: ScientificMemoryPeriod,
  ): Promise<{ record: ScientificMemoryRecord | null; evolution: ScientificMemoryEvolution }> {
    const record = await this.repo.latest(period);
    if (!record) {
      return {
        record: null,
        evolution: {
          hasPrevious: false,
          previousGeneratedAt: null,
          knowledgeEvolution: 0,
          scientificEvolution: 0,
          businessEvolution: 0,
          confidenceEvolution: 0,
          validatedTheoriesDelta: 0,
          strengtheningHypothesesDelta: 0,
          observedPatternsDelta: 0,
        },
      };
    }
    const previous = await this.repo.previous(record.generatedAt, record.period);
    return { record, evolution: computeEvolution(record, previous) };
  }

  async timeline(
    period?: ScientificMemoryPeriod,
  ): Promise<ScientificMemoryTimelineItem[]> {
    return this.repo.timeline(period);
  }
}
