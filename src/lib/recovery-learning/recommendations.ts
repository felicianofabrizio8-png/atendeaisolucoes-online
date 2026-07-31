// ============================================================================
// RECOMENDAÇÕES (Fase 6.4) — puro.
//
// Converte evidência em SUGESTÃO. Nenhuma recomendação é aplicada: o campo
// `autoApplied` é literalmente `false` no tipo, de modo que qualquer tentativa
// futura de auto-aplicar quebra o typecheck em vez de quebrar a confiança do
// cliente.
// ============================================================================

import { featureLabel } from "./features";
import { pct } from "./stats";
import type {
  CalibrationReport,
  DriftAlert,
  LearningInsight,
  LearningRecommendation,
  RecommendationKind,
} from "./types";

const KIND_BY_DIMENSION: Record<string, RecommendationKind> = {
  template: "revisar_template",
  tipo_mensagem: "revisar_template",
  comprimento: "revisar_template",
  horario: "revisar_horario",
  dia_semana: "revisar_horario",
  estrategia: "revisar_estrategia",
  tom: "revisar_estrategia",
  insistencia: "revisar_estrategia",
};

function kindOf(dimension: string): RecommendationKind {
  return KIND_BY_DIMENSION[dimension] ?? "revisar_regra";
}

export function buildRecommendations(
  insights: LearningInsight[],
  drift: DriftAlert[],
  calibration: CalibrationReport,
  limit = 8,
): LearningRecommendation[] {
  const out: LearningRecommendation[] = [];

  for (const alert of drift.slice(0, 4)) {
    if (alert.deltaPp >= 0) continue;
    out.push({
      id: `drift:${alert.id}`,
      kind: kindOf(alert.dimension),
      title: `Revisar ${featureLabel(alert.dimension, alert.value)}`,
      rationale: `${alert.text} Vale revisar antes de manter o padrão atual.`,
      samples: alert.recentSamples,
      confidence: alert.severity === "critico" ? 0.8 : 0.6,
      autoApplied: false,
    });
  }

  for (const insight of insights) {
    if (insight.direction !== "negativo") continue;
    if (out.some((r) => r.id === `insight:${insight.id}`)) continue;
    out.push({
      id: `insight:${insight.id}`,
      kind: kindOf(insight.dimension),
      title: `Revisar ${featureLabel(insight.dimension, insight.value)}`,
      rationale: `${insight.text} Considere testar uma alternativa em paralelo.`,
      samples: insight.samples,
      confidence: insight.confidence,
      autoApplied: false,
    });
  }

  for (const note of calibration.notes.slice(0, 3)) {
    out.push({
      id: `calib:${note}`,
      kind: "revisar_regra",
      title: "Revisar faixa de score",
      rationale: `${note} A regra segue valendo em produção — nenhuma alteração foi aplicada.`,
      samples: calibration.samples,
      confidence: 0.6,
      autoApplied: false,
    });
  }

  if (calibration.samples >= 20 && calibration.brier > 0.3) {
    out.push({
      id: "calib:brier",
      kind: "revisar_regra",
      title: "Chance prevista com baixa aderência",
      rationale:
        `O Brier Score está em ${calibration.brier} e a taxa observada diverge da prevista ` +
        `(precisão ${pct(calibration.precision)}%, recall ${pct(calibration.recall)}%).`,
      samples: calibration.samples,
      confidence: 0.7,
      autoApplied: false,
    });
  }

  return out
    .sort((a, b) => b.confidence * b.samples - a.confidence * a.samples)
    .slice(0, limit);
}
