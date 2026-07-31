// ============================================================================
// DRIFT DETECTION (Fase 6.4) — puro.
//
// Compara a janela recente contra a janela anterior, por dimensão. O objetivo
// não é apontar o vencedor do mês, e sim detectar que algo QUE FUNCIONAVA
// parou de funcionar — o sinal mais valioso e o mais fácil de ignorar.
// ============================================================================

import { featureLabel } from "./features";
import { aggregateDimension } from "./aggregate";
import { pct } from "./stats";
import { FEATURE_DIMENSIONS } from "./features";
import type { DriftAlert, DriftSeverity, RecoveryDatasetRow } from "./types";
import { MIN_SAMPLES } from "./types";

/** Variação mínima, em pontos percentuais, para registrar alerta. */
const MIN_DELTA_PP = 12;

function severityOf(deltaPp: number, samples: number): DriftSeverity {
  const magnitude = Math.abs(deltaPp);
  if (samples >= 20 && magnitude >= 25) return "critico";
  if (magnitude >= 18) return "atencao";
  return "info";
}

export interface DriftOptions {
  /** Divisor entre janela anterior e recente (timestamp ms). */
  splitAt: number;
  dimensions?: readonly string[];
}

export function detectDrift(
  rows: RecoveryDatasetRow[],
  options: DriftOptions,
): DriftAlert[] {
  const previous: RecoveryDatasetRow[] = [];
  const recent: RecoveryDatasetRow[] = [];
  for (const row of rows) {
    const t = new Date(row.createdAt).getTime();
    if (!Number.isFinite(t)) continue;
    (t >= options.splitAt ? recent : previous).push(row);
  }

  if (recent.length < MIN_SAMPLES || previous.length < MIN_SAMPLES) return [];

  const baseRecent = recent.filter((r) => r.recovered).length / recent.length;
  const basePrevious = previous.filter((r) => r.recovered).length / previous.length;

  const alerts: DriftAlert[] = [];
  for (const dimension of options.dimensions ?? FEATURE_DIMENSIONS) {
    const recentStats = aggregateDimension(recent, dimension, baseRecent);
    const prevStats = new Map(
      aggregateDimension(previous, dimension, basePrevious).map((s) => [s.value, s]),
    );

    for (const stat of recentStats) {
      const before = prevStats.get(stat.value);
      if (!before) continue;
      if (stat.samples < MIN_SAMPLES || before.samples < MIN_SAMPLES) continue;

      const deltaPp = Math.round((stat.recoveryRate - before.recoveryRate) * 1000) / 10;
      if (Math.abs(deltaPp) < MIN_DELTA_PP) continue;

      const label = featureLabel(dimension, stat.value);
      const dropped = deltaPp < 0;
      alerts.push({
        id: `${dimension}:${stat.value}`,
        dimension,
        value: stat.value,
        recentRate: stat.recoveryRate,
        previousRate: before.recoveryRate,
        deltaPp,
        recentSamples: stat.samples,
        previousSamples: before.samples,
        severity: severityOf(deltaPp, stat.samples),
        text:
          `${label}: recuperação passou de ${pct(before.recoveryRate)}% para ${pct(stat.recoveryRate)}% ` +
          `(${dropped ? "queda" : "alta"} de ${Math.abs(deltaPp)} pontos) entre as duas janelas.`,
      });
    }
  }

  const rank: Record<DriftSeverity, number> = { critico: 0, atencao: 1, info: 2 };
  alerts.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || Math.abs(b.deltaPp) - Math.abs(a.deltaPp),
  );
  return alerts;
}
