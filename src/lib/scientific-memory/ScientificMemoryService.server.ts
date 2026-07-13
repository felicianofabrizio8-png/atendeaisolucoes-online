// ============================================================================
// Scientific Memory — Service (Fase 4 + Quality Gate)
// Orquestra ciência + brain → build → persiste com idempotência + calcula evolução.
// Suporta dryRun (não escreve). Writes via cliente admin (server-side).
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { BusinessBrainAgent } from "@/lib/business-brain/BusinessBrainAgent.server";
import { ScientificKnowledgeAgent } from "@/lib/scientific-knowledge/ScientificKnowledgeAgent.server";
import { ScientificMemoryBuilder } from "./ScientificMemoryBuilder.server";
import { ScientificMemoryRepository } from "./ScientificMemoryRepository.server";
import type {
  ScientificMemoryEvolution,
  ScientificMemoryInsert,
  ScientificMemoryPeriod,
  ScientificMemoryRecord,
  ScientificMemoryTimelineItem,
} from "./ScientificMemoryTypes";

export interface PersistOptions {
  period?: ScientificMemoryPeriod;
  dryRun?: boolean;
}

export interface PersistResult {
  dryRun: boolean;
  alreadyExists: boolean;
  saved: ScientificMemoryRecord | null;
  payload: ScientificMemoryInsert;
  evolution: ScientificMemoryEvolution;
  sources: {
    scientificKnowledge: string;
    businessBrain: string;
    period: ScientificMemoryPeriod;
  };
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

function emptyEvolution(): ScientificMemoryEvolution {
  return {
    status: "insufficient_history",
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
  if (!previous) return emptyEvolution();
  const confDelta =
    clamp01(current.quality.avgConfidence) - clamp01(previous.quality.avgConfidence);
  const businessDelta =
    (current.businessConclusions.length - previous.businessConclusions.length) * 0.5 + confDelta;
  return {
    status: "ok",
    hasPrevious: true,
    previousGeneratedAt: previous.generatedAt,
    knowledgeEvolution: current.knowledgeScore - previous.knowledgeScore,
    scientificEvolution: current.scientificScore - previous.scientificScore,
    businessEvolution: businessDelta,
    confidenceEvolution: confDelta,
    validatedTheoriesDelta: current.validatedTheories.length - previous.validatedTheories.length,
    strengtheningHypothesesDelta:
      current.strengtheningHypotheses.length - previous.strengtheningHypotheses.length,
    observedPatternsDelta: current.observedPatterns.length - previous.observedPatterns.length,
  };
}

export class ScientificMemoryService {
  private readonly supabase: SupabaseClient<Database>;
  private readonly companyId: string;
  private readonly writer: SupabaseClient<Database>;
  private readonly repo: ScientificMemoryRepository;
  private readonly writerRepo: ScientificMemoryRepository;

  /**
   * @param supabase cliente de leitura (JWT do admin autenticado — respeita RLS).
   * @param companyId tenant derivado do JWT (nunca vindo do body).
   * @param writer cliente de escrita (service_role). Se omitido, cai no `supabase`.
   */
  constructor(
    supabase: SupabaseClient<Database>,
    companyId: string,
    writer?: SupabaseClient<Database>,
  ) {
    this.supabase = supabase;
    this.companyId = companyId;
    this.writer = writer ?? supabase;
    this.repo = new ScientificMemoryRepository(supabase, companyId);
    this.writerRepo = new ScientificMemoryRepository(this.writer, companyId);
  }

  async persist(opts: PersistOptions = {}): Promise<PersistResult> {
    const period: ScientificMemoryPeriod = opts.period ?? "30d";
    const dryRun = opts.dryRun !== false; // default seguro: dryRun

    const science = await new ScientificKnowledgeAgent({
      supabase: this.supabase,
      companyId: this.companyId,
    }).snapshot(period);

    const brain = await new BusinessBrainAgent({
      supabase: this.supabase,
      companyId: this.companyId,
    }).snapshot(period);

    const now = new Date().toISOString();
    const payload = await ScientificMemoryBuilder.build({ period, science, brain, now });

    const previous = await this.repo.previous(now, period, payload.version);

    const sources = {
      scientificKnowledge: `snapshot(${period})`,
      businessBrain: `snapshot(${period})`,
      period,
    };

    if (dryRun) {
      const existing = await this.repo.findByFingerprint(payload);
      const currentForEvo = existing ?? payload;
      return {
        dryRun: true,
        alreadyExists: !!existing,
        saved: null,
        payload,
        evolution: computeEvolution(currentForEvo, previous),
        sources,
      };
    }

    const { record, alreadyExists } = await this.writerRepo.insert(payload);
    const currentForEvo = record ?? payload;
    return {
      dryRun: false,
      alreadyExists,
      saved: record,
      payload,
      evolution: computeEvolution(currentForEvo, previous),
      sources,
    };
  }

  async latest(
    period?: ScientificMemoryPeriod,
  ): Promise<{ record: ScientificMemoryRecord | null; evolution: ScientificMemoryEvolution }> {
    const record = await this.repo.latest(period);
    if (!record) return { record: null, evolution: emptyEvolution() };
    const previous = await this.repo.previous(record.generatedAt, record.period, record.version);
    return { record, evolution: computeEvolution(record, previous) };
  }

  async timeline(period?: ScientificMemoryPeriod): Promise<ScientificMemoryTimelineItem[]> {
    return this.repo.timeline(period);
  }
}
