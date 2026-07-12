// ============================================================================
// ExecutiveAgent — Ponto de entrada do agente executivo (CEO AI).
// READ-ONLY. Recebe o cliente Supabase AUTENTICADO do usuário (RLS aplicada).
// Não usa service_role, não envia mensagens, não altera nada.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ExecutiveDashboardService } from "./ExecutiveDashboardService.server";
import type {
  ExecutiveDashboardBundle,
  ExecutiveInsight,
  ExecutiveMetricsBundle,
  ExecutivePeriod,
} from "./types";

export interface ExecutiveAgentDeps {
  supabase: SupabaseClient<Database>;
  companyId: string;
}

export class ExecutiveAgent {
  private readonly supabase: SupabaseClient<Database>;
  private readonly companyId: string;

  constructor(deps: ExecutiveAgentDeps) {
    this.supabase = deps.supabase;
    this.companyId = deps.companyId;
  }

  async snapshot(period: ExecutivePeriod = "30d"): Promise<ExecutiveDashboardBundle> {
    return ExecutiveDashboardService.build(this.supabase, this.companyId, period);
  }

  async metrics(period: ExecutivePeriod = "30d"): Promise<ExecutiveMetricsBundle> {
    return (await this.snapshot(period)).metrics;
  }

  async insights(period: ExecutivePeriod = "30d"): Promise<ExecutiveInsight[]> {
    return (await this.snapshot(period)).insights;
  }
}
