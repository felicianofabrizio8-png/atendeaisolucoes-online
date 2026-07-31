// ============================================================================
// FEATURE EXTRACTION (Fase 6.4) — puro.
//
// Transforma uma linha do dataset em features categóricas. Só entram sinais
// que a empresa pode inspecionar e explicar; nada de embeddings opacos nem de
// atributos que reconstruam a identidade do cliente.
// ============================================================================

import type { LearningFeature, RecoveryDatasetRow } from "./types";

/** Dimensões oficiais — usadas por agregação, insights e drift. */
export const FEATURE_DIMENSIONS = [
  "produto",
  "origem",
  "faixa_score",
  "janela",
  "tipo_mensagem",
  "template",
  "comprimento",
  "edicao",
  "tempo_parado",
  "valor",
  "horario",
  "dia_semana",
  "tom",
  "estrategia",
  "insistencia",
  "vendedor",
] as const;

export type FeatureDimension = (typeof FEATURE_DIMENSIONS)[number];

const DAY_LABEL = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const HOUR_LABEL: Record<string, string> = {
  madrugada: "madrugada (0h–6h)",
  manha: "manhã (6h–12h)",
  tarde: "tarde (12h–18h)",
  noite: "noite (18h–24h)",
};

const STALLED_LABEL: Record<string, string> = {
  ate_24h: "parado até 24h",
  "1_3_dias": "parado 1–3 dias",
  "3_7_dias": "parado 3–7 dias",
  mais_7_dias: "parado mais de 7 dias",
  desconhecido: "tempo parado desconhecido",
};

const VALUE_LABEL: Record<string, string> = {
  sem_valor: "sem valor estimado",
  ate_1k: "até R$ 1 mil",
  "1k_5k": "R$ 1–5 mil",
  "5k_20k": "R$ 5–20 mil",
  acima_20k: "acima de R$ 20 mil",
};

function feat(key: FeatureDimension, value: string | null, label: string): LearningFeature | null {
  if (!value) return null;
  return { key, value, label };
}

/** Extrai todas as features de uma linha. Valores ausentes são omitidos. */
export function extractFeatures(row: RecoveryDatasetRow): LearningFeature[] {
  const out: Array<LearningFeature | null> = [
    feat("produto", row.product, `Produto: ${row.product}`),
    feat("origem", row.source, `Origem: ${row.source}`),
    feat("faixa_score", row.scoreBand, `Score ${row.scoreBand}`),
    feat("janela", row.windowOpen ? "aberta" : "fechada", row.windowOpen ? "Janela aberta" : "Janela fechada"),
    feat("tipo_mensagem", row.messageKind, row.messageKind === "template" ? "Template aprovado" : "Mensagem livre"),
    feat("template", row.templateName, `Template: ${row.templateName}`),
    feat(
      "comprimento",
      row.messageLengthBucket,
      row.messageLengthBucket ? `Mensagem ${row.messageLengthBucket}` : "",
    ),
    feat("edicao", row.edited ? "editada" : "sem_edicao", row.edited ? "Editada pelo vendedor" : "Enviada sem edição"),
    feat("tempo_parado", row.stalledBand, STALLED_LABEL[row.stalledBand] ?? row.stalledBand),
    feat("valor", row.valueBand, VALUE_LABEL[row.valueBand] ?? row.valueBand),
    feat("horario", row.hourBand, HOUR_LABEL[row.hourBand] ?? row.hourBand),
    feat("dia_semana", DAY_LABEL[row.dayOfWeek] ?? null, `Dia: ${DAY_LABEL[row.dayOfWeek] ?? "-"}`),
    feat("tom", row.tone, `Tom: ${row.tone}`),
    feat("estrategia", row.strategy, `Estratégia: ${row.strategy}`),
    feat("insistencia", row.insistence, `Insistência: ${row.insistence.replace(/_/g, " ")}`),
    feat("vendedor", row.sellerId, "Vendedor"),
  ];
  return out.filter((f): f is LearningFeature => f !== null);
}

/** Rótulo legível de um par dimensão/valor — reaproveitado por UI e insights. */
export function featureLabel(dimension: string, value: string): string {
  if (dimension === "horario") return HOUR_LABEL[value] ?? value;
  if (dimension === "tempo_parado") return STALLED_LABEL[value] ?? value;
  if (dimension === "valor") return VALUE_LABEL[value] ?? value;
  if (dimension === "insistencia") return value.replace(/_/g, " ");
  return value;
}
