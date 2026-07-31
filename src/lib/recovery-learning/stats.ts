// ============================================================================
// Estatística compartilhada do Learning Engine (Fase 6.4) — puro.
//
// Todas as funções são determinísticas e sem I/O. A confiança é sempre
// derivada do tamanho da amostra: nenhuma afirmação nasce de 2 tentativas.
// ============================================================================

import { CONFIDENCE_SATURATION, MIN_SAMPLES } from "./types";

/** Confiança 0–1 saturando em `CONFIDENCE_SATURATION` amostras. */
export function sampleConfidence(samples: number): number {
  if (samples <= 0) return 0;
  if (samples < MIN_SAMPLES) return round2((samples / MIN_SAMPLES) * 0.3);
  const extra = Math.min(1, (samples - MIN_SAMPLES) / (CONFIDENCE_SATURATION - MIN_SAMPLES));
  return round2(0.3 + extra * 0.65);
}

/**
 * Taxa suavizada (Laplace/Bayes) contra a taxa base.
 *
 * Impede que "1 de 1 recuperado" vire 100%: grupos pequenos são puxados de
 * volta para a média da empresa, exatamente o comportamento que evita a IA
 * afirmar o que não pode sustentar.
 */
export function smoothedRate(successes: number, total: number, prior: number, weight = 10): number {
  if (total <= 0) return prior;
  return (successes + prior * weight) / (total + weight);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function pct(n: number): number {
  return Math.round(n * 1000) / 10;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Correlação de postos de Spearman entre duas ordenações. */
export function spearman(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 1;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return round2(1 - (6 * sum) / (n * (n * n - 1)));
}

/** Hash estável e curto (FNV-1a) — usado para fingerprint de mensagem. */
export function fingerprint(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fp_${h.toString(36)}`;
}
