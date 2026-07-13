// ============================================================================
// BusinessBrainAgent — Ponto de entrada do "Professor". READ-ONLY.
// Não conversa, não responde, não decide, não envia. Apenas aprende.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { BusinessBrainService } from "./BusinessBrainService.server";
import type { BrainPeriod, BusinessBrainSnapshot } from "./BusinessBrainTypes";

export interface BusinessBrainAgentDeps {
  supabase: SupabaseClient<Database>;
  companyId: string;
}

export class BusinessBrainAgent {
  private readonly supabase: SupabaseClient<Database>;
  private readonly companyId: string;

  constructor(deps: BusinessBrainAgentDeps) {
    this.supabase = deps.supabase;
    this.companyId = deps.companyId;
  }

  async snapshot(period: BrainPeriod = "30d"): Promise<BusinessBrainSnapshot> {
    return BusinessBrainService.build(this.supabase, this.companyId, period);
  }
}
