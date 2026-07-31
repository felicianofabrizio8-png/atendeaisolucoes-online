// ============================================================================
// RECOVERY LEARNING ENGINE — Contratos (SPRINT 6 · FASE 6.4)
//
// Este módulo aprende com o RESULTADO REAL das recuperações. Ele opera
// exclusivamente em SHADOW MODE: nada aqui altera Recovery Score, chance,
// tier ou ordem da fila em produção. O aprendizado apenas MEDE e EXPLICA.
//
// PRIVACIDADE (inegociável)
//  · nenhum texto integral de mensagem é registrado — apenas fingerprint
//    (hash estável) e faixa de comprimento;
//  · nenhum nome de cliente, telefone, e-mail ou identificador externo;
//  · aprendizado sempre escopado a UMA empresa (sem treino cruzado).
// ============================================================================

/** Resultado observável de uma tentativa concluída. */
export type LearningOutcome = "recovered" | "not_recovered" | "no_reply" | "failed";

/** Faixa de comprimento da mensagem — substitui o texto. */
export type MessageLengthBucket = "curta" | "media" | "longa";

/** Tipo de mensagem usada na tentativa. */
export type MessageKind = "template" | "livre";

/** Nível de insistência derivado da quantidade de tentativas na conversa. */
export type InsistenceLevel = "primeira" | "segunda" | "terceira_ou_mais";

/** Evento de aprendizado — uma tentativa concluída, sem PII. */
export interface RecoveryLearningEvent {
  attemptId: string;
  companyId: string;
  leadId: string;
  conversationId: string;

  product: string | null;
  source: string | null;
  channel: string;

  /** Score/chance/tier vigentes NO MOMENTO da tentativa (não recalculados). */
  score: number | null;
  chance: number | null;
  tier: string | null;

  /** Hora local (0–23) e dia da semana (0=domingo) do envio. */
  hourOfDay: number;
  dayOfWeek: number;
  /** Horas paradas antes da tentativa. */
  stalledHours: number | null;
  windowOpen: boolean;

  templateId: string | null;
  templateName: string | null;
  /** Hash estável da mensagem — NUNCA o texto. */
  messageFingerprint: string | null;
  messageLengthBucket: MessageLengthBucket | null;
  messageKind: MessageKind;
  /** O vendedor editou a sugestão da IA antes de enviar? */
  edited: boolean;

  tone: string | null;
  strategy: string | null;
  insistence: InsistenceLevel;
  sellerId: string | null;

  outcome: LearningOutcome;
  responded: boolean;
  recovered: boolean;
  timeToReplyMs: number | null;
  timeToRecoveryMs: number | null;
  estimatedValue: number | null;

  createdAt: string;
}

/** Linha do dataset — evento normalizado e pronto para agregação. */
export interface RecoveryDatasetRow extends RecoveryLearningEvent {
  /** Faixa de score em blocos de 10 (ex.: "60-69"). */
  scoreBand: string;
  /** Faixa de tempo parado. */
  stalledBand: string;
  /** Faixa de horário legível. */
  hourBand: string;
  /** Faixa de valor estimado. */
  valueBand: string;
}

export interface RecoveryDataset {
  rows: RecoveryDatasetRow[];
  /** Janela analisada. */
  from: string | null;
  to: string | null;
  total: number;
  responded: number;
  recovered: number;
  /** Taxa base de recuperação (0–1) — âncora de todos os insights. */
  baseRecoveryRate: number;
  /** Taxa base de resposta (0–1). */
  baseReplyRate: number;
}

/** Uma feature extraída — sempre categórica, sempre anonimizada. */
export interface LearningFeature {
  key: string;
  value: string;
  label: string;
}

/** Estatística de um grupo (produto, origem, template...). */
export interface GroupStat {
  dimension: string;
  value: string;
  samples: number;
  responded: number;
  recovered: number;
  replyRate: number;
  recoveryRate: number;
  /** Diferença em pontos percentuais contra a taxa base. */
  liftPp: number;
  /** 0–1: quão confiável é a amostra. */
  confidence: number;
  avgTimeToReplyMs: number | null;
  avgTimeToRecoveryMs: number | null;
}

/** Insight probabilístico com explainability obrigatória. */
export interface LearningInsight {
  id: string;
  dimension: string;
  value: string;
  /** Texto em linguagem probabilística — nunca causal. */
  text: string;
  direction: "positivo" | "negativo" | "neutro";
  samples: number;
  confidence: number;
  liftPp: number;
  windowLabel: string;
  updatedAt: string;
}

/** Score alternativo — comparado ao de produção, nunca aplicado. */
export interface ShadowScoreResult {
  conversationId: string;
  currentScore: number;
  learnedScore: number;
  deltaPoints: number;
  confidence: number;
  /** Fatores aprendidos que empurraram o shadow score. */
  reasons: Array<{ label: string; points: number; samples: number }>;
}

export interface ShadowRankingMove {
  conversationId: string;
  leadName: string;
  currentPosition: number;
  shadowPosition: number;
  delta: number;
  currentScore: number;
  learnedScore: number;
}

export interface ShadowRankingResult {
  totalItems: number;
  changedItems: number;
  changeRatio: number;
  /** Correlação de Spearman entre as duas ordens (1 = idênticas). */
  spearman: number;
  wouldRiseTop: ShadowRankingMove[];
  wouldFallTop: ShadowRankingMove[];
}

export type DriftSeverity = "info" | "atencao" | "critico";

export interface DriftAlert {
  id: string;
  dimension: string;
  value: string;
  recentRate: number;
  previousRate: number;
  deltaPp: number;
  recentSamples: number;
  previousSamples: number;
  severity: DriftSeverity;
  text: string;
}

export interface CalibrationBin {
  band: string;
  predicted: number;
  observed: number;
  samples: number;
}

export interface CalibrationReport {
  samples: number;
  /** Erro absoluto médio da chance prevista (0–1). */
  chanceMae: number;
  /** Erro absoluto médio do score normalizado (0–1). */
  scoreMae: number;
  brier: number;
  precision: number;
  recall: number;
  f1: number;
  threshold: number;
  curve: CalibrationBin[];
  /** Faixas em que o score se mostrou superestimado/subestimado. */
  notes: string[];
}

export type RecommendationKind =
  | "revisar_regra"
  | "revisar_template"
  | "revisar_horario"
  | "revisar_estrategia";

export interface LearningRecommendation {
  id: string;
  kind: RecommendationKind;
  title: string;
  rationale: string;
  samples: number;
  confidence: number;
  /** Sempre false nesta fase: nada é aplicado automaticamente. */
  autoApplied: false;
}

export interface RecoveryLearningReport {
  dataset: Omit<RecoveryDataset, "rows">;
  windowLabel: string;
  generatedAt: string;
  groups: Record<string, GroupStat[]>;
  insights: LearningInsight[];
  drift: DriftAlert[];
  calibration: CalibrationReport;
  recommendations: LearningRecommendation[];
  shadowRanking: ShadowRankingResult | null;
  avgTimeToReplyMs: number | null;
  avgTimeToRecoveryMs: number | null;
}

/** Amostra mínima para qualquer afirmação estatística. */
export const MIN_SAMPLES = 8;
/** Amostra a partir da qual a confiança satura. */
export const CONFIDENCE_SATURATION = 40;
