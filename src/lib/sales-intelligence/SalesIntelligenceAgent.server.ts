// ============================================================================
// SalesIntelligenceAgent — ponto de entrada do agente comercial (Diretor de Vendas).
// READ-ONLY. Recebe cliente Supabase autenticado do usuário (RLS aplicada).
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ExecutivePeriod } from "@/lib/executive-ai/types";
import { SalesIntelligenceService } from "./SalesIntelligenceService.server";
import type { SalesIntelligenceBundle } from "./SalesIntelligenceTypes";

export interface SalesIntelligenceAgentDeps {
  supabase: SupabaseClient<Database>;
  companyId: string;
}

export class SalesIntelligenceAgent {
  private readonly supabase: SupabaseClient<Database>;
  private readonly companyId: string;
  constructor(deps: SalesIntelligenceAgentDeps) {
    this.supabase = deps.supabase;
    this.companyId = deps.companyId;
  }

  async run(
    period: Extract<ExecutivePeriod, "7d" | "30d" | "90d"> = "30d",
  ): Promise<SalesIntelligenceBundle> {
    return SalesIntelligenceService.generate({
      supabase: this.supabase,
      companyId: this.companyId,
      period,
    });
  }
}
