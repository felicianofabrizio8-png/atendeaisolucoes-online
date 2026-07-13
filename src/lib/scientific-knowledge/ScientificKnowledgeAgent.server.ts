// ============================================================================
// ScientificKnowledgeAgent — Ponto de entrada da camada científica.
// READ-ONLY. Não conversa, não decide, não é consumido por agentes
// operacionais nesta fase.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ScientificKnowledgeService } from "./ScientificKnowledgeService.server";
import type {
  SciencePeriod,
  ScientificKnowledgeSnapshot,
} from "./ScientificKnowledgeTypes";

export interface ScientificKnowledgeAgentDeps {
  supabase: SupabaseClient<Database>;
  companyId: string;
}

export class ScientificKnowledgeAgent {
  private readonly supabase: SupabaseClient<Database>;
  private readonly companyId: string;

  constructor(deps: ScientificKnowledgeAgentDeps) {
    this.supabase = deps.supabase;
    this.companyId = deps.companyId;
  }

  async snapshot(period: SciencePeriod = "30d"): Promise<ScientificKnowledgeSnapshot> {
    return ScientificKnowledgeService.build(this.supabase, this.companyId, period);
  }
}
