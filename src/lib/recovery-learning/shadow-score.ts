// ============================================================================
// SHADOW SCORE (Fase 6.4) — puro.
//
// Calcula um score ALTERNATIVO a partir do que os resultados reais mostraram,
// e o compara ao score de produção. Este valor NUNCA substitui o score da
// Fase 6.1: ele existe para medir a distância entre "o que a regra acha" e
// "o que aconteceu".
//
// Modelo: ajustes aditivos por feature, cada um proporcional ao lift do grupo
// e amortecido pela confiança da amostra. Simples de auditar de propósito —
// um modelo que o dono da empresa não consegue explicar não pode governar
// prioridade de atendimento.
// ============================================================================

import { extractFeatures, featureLabel } from "./features";
import { round2, smoothedRate } from "./stats";
import type { GroupStat, RecoveryDatasetRow, ShadowScoreResult } from "./types";
import { MIN_SAMPLES } from "./types";

/** Peso máximo, em pontos de score, que UMA feature pode mover. */
const MAX_FEATURE_POINTS = 12;
/** Peso máximo somado de todas as features. */
const MAX_TOTAL_POINTS = 30;

export interface ShadowModel {
  /** chave `dimensao:valor` → ajuste em pontos e metadados. */
  weights: Map<string, { points: number; samples: number; label: string; confidence: number }>;
  baseRate: number;
  samples: number;
}

export function trainShadowModel(
  groups: Record<string, GroupStat[]>,
  baseRate: number,
  totalSamples: number,
): ShadowModel {
  const weights = new Map<string, { points: number; samples: number; label: string; confidence: number }>();

  for (const stats of Object.values(groups)) {
    for (const stat of stats) {
      if (stat.samples < MIN_SAMPLES) continue;
      // Taxa suavizada: grupos pequenos convergem para a base da empresa.
      const rate = smoothedRate(stat.recovered, stat.samples, baseRate);
      const lift = rate - baseRate;
      const raw = lift * 100 * stat.confidence;
      const points = round2(Math.max(-MAX_FEATURE_POINTS, Math.min(MAX_FEATURE_POINTS, raw)));
      if (Math.abs(points) < 0.5) continue;
      weights.set(`${stat.dimension}:${stat.value}`, {
        points,
        samples: stat.samples,
        confidence: stat.confidence,
        label: `${featureLabel(stat.dimension, stat.value)}`,
      });
    }
  }

  return { weights, baseRate, samples: totalSamples };
}

/** Entrada mínima para pontuar em shadow — aceita fila viva ou linha do dataset. */
export interface ShadowScoreInput {
  conversationId: string;
  score: number;
  features: Array<{ key: string; value: string }>;
}

export function shadowScore(model: ShadowModel, input: ShadowScoreInput): ShadowScoreResult {
  const reasons: ShadowScoreResult["reasons"] = [];
  let delta = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;

  for (const f of input.features) {
    const w = model.weights.get(`${f.key}:${f.value}`);
    if (!w) continue;
    delta += w.points;
    confidenceSum += w.confidence;
    confidenceCount += 1;
    reasons.push({ label: w.label, points: w.points, samples: w.samples });
  }

  delta = Math.max(-MAX_TOTAL_POINTS, Math.min(MAX_TOTAL_POINTS, delta));
  const learned = Math.max(0, Math.min(100, Math.round(input.score + delta)));
  reasons.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));

  return {
    conversationId: input.conversationId,
    currentScore: input.score,
    learnedScore: learned,
    deltaPoints: learned - input.score,
    confidence: confidenceCount > 0 ? round2(confidenceSum / confidenceCount) : 0,
    reasons: reasons.slice(0, 5),
  };
}

/** Features de uma linha do dataset, no formato aceito por `shadowScore`. */
export function featuresOfRow(row: RecoveryDatasetRow): Array<{ key: string; value: string }> {
  return extractFeatures(row).map((f) => ({ key: f.key, value: f.value }));
}
