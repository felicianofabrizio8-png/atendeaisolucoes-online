// ============================================================================
// BusinessLearningAgent — Ponto de entrada do "Professor Contínuo".
// READ-ONLY. Não conversa, não responde, não decide, não envia mensagens,
// não é consumido por nenhum agente operacional nesta fase.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { BusinessLearningService } from "./BusinessLearningService.server";
import type { BusinessLearningSnapshot, LearningPeriod } from "./BusinessLearningTypes";

export interface BusinessLearningAgentDeps {
  supabase: SupabaseClient<Database>;
  companyId: string;
}

export class BusinessLearningAgent {
  private readonly supabase: SupabaseClient<Database>;
  private readonly companyId: string;

  constructor(deps: BusinessLearningAgentDeps) {
    this.supabase = deps.supabase;
    this.companyId = deps.companyId;
  }

  async snapshot(period: LearningPeriod = "30d"): Promise<BusinessLearningSnapshot> {
    return BusinessLearningService.build(this.supabase, this.companyId, period);
  }
}
