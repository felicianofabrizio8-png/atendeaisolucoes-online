// ============================================================================
// ExecutiveAgent — Ponto de entrada do agente executivo (CEO AI).
// READ-ONLY: expõe uma API de alto nível para consultas estratégicas.
// Não envia mensagens, não altera nenhuma tabela, não dispara IA de atendimento.
// ============================================================================

import { ExecutiveDashboardService } from "./ExecutiveDashboardService.server";
import type {
  ExecutiveDashboardBundle,
  ExecutiveInsight,
  ExecutiveMetricsBundle,
  ExecutivePeriod,
} from "./types";

export class ExecutiveAgent {
  constructor(private readonly companyId: string) {}

  /** Snapshot completo (métricas + insights) do período informado. */
  async snapshot(period: ExecutivePeriod = "7d"): Promise<ExecutiveDashboardBundle> {
    return ExecutiveDashboardService.build(this.companyId, period);
  }

  /** Apenas as métricas quantitativas. */
  async metrics(period: ExecutivePeriod = "7d"): Promise<ExecutiveMetricsBundle> {
    const bundle = await this.snapshot(period);
    return bundle.metrics;
  }

  /** Apenas os insights estratégicos gerados. */
  async insights(period: ExecutivePeriod = "7d"): Promise<ExecutiveInsight[]> {
    const bundle = await this.snapshot(period);
    return bundle.insights;
  }
}
