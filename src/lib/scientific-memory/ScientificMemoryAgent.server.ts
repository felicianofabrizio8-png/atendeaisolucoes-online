// ============================================================================
// Scientific Memory — Agent (Fase 4)
// Ponto de entrada da Memória Científica Permanente do Professor AI.
// Nenhum consumidor operacional nesta fase.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ScientificMemoryService } from "./ScientificMemoryService.server";
import type {
  ScientificMemoryEvolution,
  ScientificMemoryPeriod,
  ScientificMemoryRecord,
  ScientificMemoryTimelineItem,
} from "./ScientificMemoryTypes";

export interface ScientificMemoryAgentDeps {
  supabase: SupabaseClient<Database>;
  companyId: string;
}

export class ScientificMemoryAgent {
  private readonly service: ScientificMemoryService;

  constructor(deps: ScientificMemoryAgentDeps) {
    this.service = new ScientificMemoryService(deps.supabase, deps.companyId);
  }

  /** Gera + persiste + calcula evolução. Não é acionado por agentes operacionais. */
  persist(period: ScientificMemoryPeriod = "30d"): Promise<{
    saved: ScientificMemoryRecord | null;
    evolution: ScientificMemoryEvolution;
  }> {
    return this.service.persist(period);
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
