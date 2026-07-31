// ============================================================================
// CALIBRAÇÃO (Fase 6.4) — puro.
//
// Mede o quanto a chance prevista pela Fase 6.1 corresponde ao que aconteceu.
// Um score bem ordenado mas mal calibrado (diz 80% e entrega 30%) engana o
// vendedor; por isso medimos Brier, erro absoluto e a curva por faixa.
//
// Nada aqui reescreve o score de produção.
// ============================================================================

import { round2 } from "./stats";
import type { CalibrationBin, CalibrationReport, RecoveryDatasetRow } from "./types";
import { MIN_SAMPLES } from "./types";

const EMPTY: CalibrationReport = {
  samples: 0,
  chanceMae: 0,
  scoreMae: 0,
  brier: 0,
  precision: 0,
  recall: 0,
  f1: 0,
  threshold: 0.5,
  curve: [],
  notes: [],
};

/**
 * @param threshold probabilidade a partir da qual o sistema "prevê recuperação".
 */
export function buildCalibration(rows: RecoveryDatasetRow[], threshold = 0.5): CalibrationReport {
  const usable = rows.filter((r) => r.chance !== null || r.score !== null);
  if (usable.length === 0) return EMPTY;

  let brierSum = 0;
  let chanceErrSum = 0;
  let chanceCount = 0;
  let scoreErrSum = 0;
  let scoreCount = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;

  const bins = new Map<string, { predicted: number[]; observed: number[] }>();

  for (const row of usable) {
    const actual = row.recovered ? 1 : 0;
    const chance = row.chance !== null ? Math.max(0, Math.min(1, row.chance / 100)) : null;
    const score = row.score !== null ? Math.max(0, Math.min(1, row.score / 100)) : null;
    const predicted = chance ?? score ?? 0;

    brierSum += (predicted - actual) ** 2;
    if (chance !== null) {
      chanceErrSum += Math.abs(chance - actual);
      chanceCount += 1;
    }
    if (score !== null) {
      scoreErrSum += Math.abs(score - actual);
      scoreCount += 1;
    }

    const positive = predicted >= threshold;
    if (positive && actual === 1) tp += 1;
    else if (positive && actual === 0) fp += 1;
    else if (!positive && actual === 1) fn += 1;

    const floor = Math.min(90, Math.floor(predicted * 10) * 10);
    const band = `${floor}-${floor + 9}`;
    const bucket = bins.get(band) ?? { predicted: [], observed: [] };
    bucket.predicted.push(predicted);
    bucket.observed.push(actual);
    bins.set(band, bucket);
  }

  const curve: CalibrationBin[] = Array.from(bins.entries())
    .map(([band, b]) => ({
      band,
      predicted: round2(b.predicted.reduce((a, c) => a + c, 0) / b.predicted.length),
      observed: round2(b.observed.reduce((a, c) => a + c, 0) / b.observed.length),
      samples: b.observed.length,
    }))
    .sort((a, b) => Number(a.band.split("-")[0]) - Number(b.band.split("-")[0]));

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const notes: string[] = [];
  for (const bin of curve) {
    if (bin.samples < MIN_SAMPLES) continue;
    const gap = Math.round((bin.predicted - bin.observed) * 100);
    if (gap >= 15) notes.push(`Faixa ${bin.band} parece superestimada em ~${gap} pontos.`);
    else if (gap <= -15) notes.push(`Faixa ${bin.band} parece subestimada em ~${Math.abs(gap)} pontos.`);
  }

  return {
    samples: usable.length,
    chanceMae: chanceCount > 0 ? round2(chanceErrSum / chanceCount) : 0,
    scoreMae: scoreCount > 0 ? round2(scoreErrSum / scoreCount) : 0,
    brier: round2(brierSum / usable.length),
    precision: round2(precision),
    recall: round2(recall),
    f1: round2(f1),
    threshold,
    curve,
    notes,
  };
}
