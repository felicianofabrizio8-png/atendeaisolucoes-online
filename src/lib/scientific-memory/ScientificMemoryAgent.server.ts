// ============================================================================
// Scientific Memory — Agent (Fase 4)
// Ponto de entrada da Memória Científica Permanente do Professor AI.
// Nenhum consumidor operacional nesta fase.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ScientificMemoryService, type PersistOptions, type PersistResult } from "./ScientificMemoryService.server";
import type {
  ScientificMemoryEvolution,
  ScientificMemoryPeriod,
  ScientificMemoryRecord,
  ScientificMemoryTimelineItem,
} from "./ScientificMemoryTypes";

export interface ScientificMemoryAgentDeps {
  supabase: SupabaseClient<Database>;
  companyId: string;
  writer?: SupabaseClient<Database>;
}

export class ScientificMemoryAgent {
  private readonly service: ScientificMemoryService;

  constructor(deps: ScientificMemoryAgentDeps) {
    this.service = new ScientificMemoryService(deps.supabase, deps.companyId, deps.writer);
  }

  /** Gera + (opcionalmente) persiste + calcula evolução. dryRun por padrão. */
  persist(opts: PersistOptions = {}): Promise<PersistResult> {
    return this.service.persist(opts);
  }

  latest(period?: ScientificMemoryPeriod): Promise<{
    record: ScientificMemoryRecord | null;
    evolution: ScientificMemoryEvolution;
  }> {
    return this.service.latest(period);
  }

  timeline(period?: ScientificMemoryPeriod): Promise<ScientificMemoryTimelineItem[]> {
    return this.service.timeline(period);
  }
}

