// ============================================================================
// AGREGAÇÃO POR FEATURE (Fase 6.4) — puro.
//
// Produz `GroupStat` por dimensão. É a base do dashboard, dos insights, do
// drift e do shadow score. Nenhum grupo abaixo de `MIN_SAMPLES` recebe
// tratamento de "evidência" — ele aparece no painel, mas com confiança baixa.
// ============================================================================

import { extractFeatures, FEATURE_DIMENSIONS } from "./features";
import { mean, round2, sampleConfidence } from "./stats";
import type { GroupStat, RecoveryDataset, RecoveryDatasetRow } from "./types";

interface Acc {
  samples: number;
  responded: number;
  recovered: number;
  replyTimes: number[];
  recoveryTimes: number[];
}

function emptyAcc(): Acc {
  return { samples: 0, responded: 0, recovered: 0, replyTimes: [], recoveryTimes: [] };
}

function accumulate(acc: Acc, row: RecoveryDatasetRow): void {
  acc.samples += 1;
  if (row.responded) acc.responded += 1;
  if (row.recovered) acc.recovered += 1;
  if (row.timeToReplyMs !== null) acc.replyTimes.push(row.timeToReplyMs);
  if (row.timeToRecoveryMs !== null) acc.recoveryTimes.push(row.timeToRecoveryMs);
}

function toStat(dimension: string, value: string, acc: Acc, baseRate: number): GroupStat {
  const recoveryRate = acc.samples > 0 ? acc.recovered / acc.samples : 0;
  return {
    dimension,
    value,
    samples: acc.samples,
    responded: acc.responded,
    recovered: acc.recovered,
    replyRate: acc.samples > 0 ? round2(acc.responded / acc.samples) : 0,
    recoveryRate: round2(recoveryRate),
    liftPp: Math.round((recoveryRate - baseRate) * 1000) / 10,
    confidence: sampleConfidence(acc.samples),
    avgTimeToReplyMs: mean(acc.replyTimes),
    avgTimeToRecoveryMs: mean(acc.recoveryTimes),
  };
}

/** Agrega o dataset em todas as dimensões declaradas em `FEATURE_DIMENSIONS`. */
export function aggregateGroups(dataset: RecoveryDataset): Record<string, GroupStat[]> {
  const buckets = new Map<string, Map<string, Acc>>();
  for (const dim of FEATURE_DIMENSIONS) buckets.set(dim, new Map());

  for (const row of dataset.rows) {
    for (const f of extractFeatures(row)) {
      const dim = buckets.get(f.key);
      if (!dim) continue;
      const acc = dim.get(f.value) ?? emptyAcc();
      accumulate(acc, row);
      dim.set(f.value, acc);
    }
  }

  const out: Record<string, GroupStat[]> = {};
  for (const [dimension, values] of buckets) {
    const stats: GroupStat[] = [];
    for (const [value, acc] of values) {
      stats.push(toStat(dimension, value, acc, dataset.baseRecoveryRate));
    }
    stats.sort((a, b) => b.samples - a.samples || b.recoveryRate - a.recoveryRate);
    out[dimension] = stats;
  }
  return out;
}

/** Agregação de uma única dimensão — usada em recortes do painel. */
export function aggregateDimension(
  rows: RecoveryDatasetRow[],
  dimension: string,
  baseRate: number,
): GroupStat[] {
  const values = new Map<string, Acc>();
  for (const row of rows) {
    for (const f of extractFeatures(row)) {
      if (f.key !== dimension) continue;
      const acc = values.get(f.value) ?? emptyAcc();
      accumulate(acc, row);
      values.set(f.value, acc);
    }
  }
  return Array.from(values.entries())
    .map(([value, acc]) => toStat(dimension, value, acc, baseRate))
    .sort((a, b) => b.samples - a.samples);
}
