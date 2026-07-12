// ============================================================================
// ExecutiveDashboardService — Fachada para o futuro Dashboard Executivo.
// READ-ONLY: orquestra Analyzer + Metrics + Insights e retorna um bundle único.
// ============================================================================

import { ExecutiveAnalyzer, resolveRange } from "./ExecutiveAnalyzer.server";
import { ExecutiveMetrics } from "./ExecutiveMetrics.server";
import { ExecutiveInsights } from "./ExecutiveInsights.server";
import type { ExecutiveDashboardBundle, ExecutivePeriod } from "./types";

export class ExecutiveDashboardService {
  static async build(
    companyId: string,
    period: ExecutivePeriod = "7d",
  ): Promise<ExecutiveDashboardBundle> {
    const range = resolveRange(period);
    const analyzer = new ExecutiveAnalyzer(companyId, range);
    const dataset = await analyzer.load();
    const metrics = new ExecutiveMetrics(dataset, range).compute();
    const insights = new ExecutiveInsights(metrics, dataset).build();
    return {
      range,
      metrics,
      insights,
      generatedAt: new Date().toISOString(),
    };
  }
}
