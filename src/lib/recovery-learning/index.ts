// ============================================================================
// RECOVERY LEARNING ENGINE — Barrel público (SPRINT 6 · FASE 6.4).
//
// Somente módulos PUROS: nada aqui importa Supabase, React ou relógio global.
// TODO o aprendizado é SHADOW MODE — nenhuma função deste diretório escreve
// score, chance, tier ou ordem de fila em produção.
// ============================================================================

export * from "./types";
export {
  buildDataset,
  buildDatasetFromAttempts,
  toLearningEvent,
  toDatasetRow,
  isObservable,
  lengthBucket,
  insistenceOf,
  outcomeOf,
  scoreBandOf,
  stalledBandOf,
  hourBandOf,
  valueBandOf,
  type AttemptLike,
} from "./dataset";
export {
  extractFeatures,
  featureLabel,
  FEATURE_DIMENSIONS,
  type FeatureDimension,
} from "./features";
export { aggregateGroups, aggregateDimension } from "./aggregate";
export {
  trainShadowModel,
  shadowScore,
  featuresOfRow,
  type ShadowModel,
  type ShadowScoreInput,
} from "./shadow-score";
export { buildShadowRanking, type RankingItem } from "./shadow-ranking";
export { buildInsights } from "./insights";
export { detectDrift, type DriftOptions } from "./drift";
export { buildCalibration } from "./calibration";
export { buildRecommendations } from "./recommendations";
export { featuresOfQueueItem, type LiveQueueLike } from "./live";
export { sampleConfidence, smoothedRate, spearman, fingerprint, mean, pct } from "./stats";

import { buildDataset } from "./dataset";
import { aggregateGroups } from "./aggregate";
import { buildInsights } from "./insights";
import { detectDrift } from "./drift";
import { buildCalibration } from "./calibration";
import { buildRecommendations } from "./recommendations";
import { trainShadowModel, type ShadowModel } from "./shadow-score";
import { mean } from "./stats";
import type {
  GroupStat,
  RecoveryLearningEvent,
  RecoveryLearningReport,
} from "./types";

/** Pesos do modelo em formato serializável (o `Map` não cruza o RPC). */
export interface SerializedShadowModel {
  baseRate: number;
  samples: number;
  weights: Array<{ key: string; points: number; samples: number; label: string; confidence: number }>;
}

export function serializeModel(model: ShadowModel): SerializedShadowModel {
  return {
    baseRate: model.baseRate,
    samples: model.samples,
    weights: Array.from(model.weights.entries()).map(([key, w]) => ({ key, ...w })),
  };
}

export function deserializeModel(input: SerializedShadowModel): ShadowModel {
  return {
    baseRate: input.baseRate,
    samples: input.samples,
    weights: new Map(
      input.weights.map((w) => [
        w.key,
        { points: w.points, samples: w.samples, label: w.label, confidence: w.confidence },
      ]),
    ),
  };
}

export interface LearningReportOptions {
  windowLabel: string;
  now: number;
  /** Divisor entre janela anterior e recente para o drift. */
  driftSplitAt: number;
  /** Dimensões destacadas no painel. */
  dashboardDimensions?: string[];
}

const DASHBOARD_DIMENSIONS = [
  "produto",
  "origem",
  "horario",
  "vendedor",
  "template",
  "estrategia",
  "tom",
  "insistencia",
];

/**
 * Orquestra o ciclo completo de aprendizado a partir dos eventos já coletados.
 * Determinístico: mesmos eventos + mesmo `now` ⇒ mesmo relatório.
 */
export function buildLearningReport(
  events: RecoveryLearningEvent[],
  options: LearningReportOptions,
): { report: RecoveryLearningReport; model: ShadowModel } {
  const dataset = buildDataset(events);
  const groups = aggregateGroups(dataset);
  const generatedAt = new Date(options.now).toISOString();

  const insights = buildInsights(dataset, groups, options.windowLabel, generatedAt);
  const drift = detectDrift(dataset.rows, { splitAt: options.driftSplitAt });
  const calibration = buildCalibration(dataset.rows);
  const recommendations = buildRecommendations(insights, drift, calibration);
  const model = trainShadowModel(groups, dataset.baseRecoveryRate, dataset.total);

  const wanted = new Set(options.dashboardDimensions ?? DASHBOARD_DIMENSIONS);
  const dashboardGroups: Record<string, GroupStat[]> = {};
  for (const [dim, stats] of Object.entries(groups)) {
    if (wanted.has(dim)) dashboardGroups[dim] = stats;
  }

  const { rows, ...datasetSummary } = dataset;

  return {
    model,
    report: {
      dataset: datasetSummary,
      windowLabel: options.windowLabel,
      generatedAt,
      groups: dashboardGroups,
      insights,
      drift,
      calibration,
      recommendations,
      shadowRanking: null,
      avgTimeToReplyMs: mean(
        rows.map((r) => r.timeToReplyMs).filter((n): n is number => n !== null),
      ),
      avgTimeToRecoveryMs: mean(
        rows.map((r) => r.timeToRecoveryMs).filter((n): n is number => n !== null),
      ),
    },
  };
}
