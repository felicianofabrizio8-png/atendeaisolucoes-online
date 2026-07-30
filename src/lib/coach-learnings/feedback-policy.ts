// ============================================================================
// Coach Evolutivo — Política de feedback e confiança (SPRINT 4 · FASE 4)
//
// PAPEL DESTE MÓDULO
// ------------------
// Espelho PURO das fórmulas que vivem no banco. A aplicação real das métricas
// acontece dentro da RPC `submit_coach_suggestion_feedback_v2`, porque só lá
// é possível travar a linha e atualizar contadores atomicamente.
//
// Este módulo existe para três coisas — nenhuma delas é "recalcular por fora":
//   1. Dar tipos e nomes ao contrato de feedback.
//   2. Permitir que o retriever leia o histórico com a MESMA semântica.
//   3. Permitir testar a curva de confiança sem subir um Postgres.
//
// RISCO CONHECIDO: fórmula duplicada entre SQL e TS pode divergir com o tempo.
// MITIGAÇÃO: `__tests__/feedback-policy.test.ts` lê a migration SQL e falha se
// qualquer constante abaixo não aparecer literalmente no arquivo.
//
// PROPRIEDADE CENTRAL DO DESENHO
// ------------------------------
// `successRate` e `confidence` são FUNÇÕES PURAS dos contadores acumulados.
// Não são acumuladores. Consequências diretas:
//   - trocar 👍→👎 nunca deixa resíduo do voto anterior;
//   - reprocessar o mesmo estado produz o mesmo número (idempotente);
//   - não existe deriva numérica ao longo de milhares de eventos.
// ============================================================================

/** Valor de feedback aceito pela UI e pela RPC. */
export type CoachFeedbackValue = "positive" | "negative" | "cleared";

/** Valor efetivamente persistido (`cleared` vira ausência de feedback). */
export type CoachFeedbackStatus = "positive" | "negative" | null;

// ---------------------------------------------------------------------------
// Constantes — DEVEM bater com a migration (há teste que verifica isso).
// ---------------------------------------------------------------------------
export const COACH_FEEDBACK_POLICY = {
  /**
   * Prior bayesiano neutro. Impede que a primeira avaliação vire um
   * veredito absoluto: 1 positivo → 0.60 (não 1.00); 1 negativo → 0.40.
   */
  PRIOR_ALPHA: 2.0,
  PRIOR_BETA: 2.0,

  /** Confiança de partida — igual ao default da coluna. */
  BASE_CONFIDENCE: 0.7,

  /**
   * Amplitude máxima do deslocamento da confiança. Com amortecimento pleno,
   * a assíntota é 0.7 ± 0.45 → [0.25, 0.95].
   */
  CONFIDENCE_SPREAD: 0.9,

  /**
   * Amortecimento por amostra: n/(n+5). Com 1 avaliação o efeito é ~17% do
   * total; só perto de 20 avaliações o sinal se aproxima do valor pleno.
   * É isto que torna o ajuste "gradual" em vez de reativo.
   */
  SAMPLE_SMOOTHING: 5.0,

  /** Limites duros. Um único 👎 jamais pode invalidar uma regra. */
  MIN_CONFIDENCE: 0.15,
  MAX_CONFIDENCE: 0.95,

  /** Peso do evento: derivado do rank e do score da recuperação. */
  RANK_DECAY_PER_POSITION: 0.08,
  RANK_WEIGHT_FLOOR: 0.6,
  SCORE_WEIGHT_BASE: 0.8,
  SCORE_WEIGHT_RANGE: 0.4,
  EVENT_WEIGHT_MIN: 0.5,
  EVENT_WEIGHT_MAX: 1.25,

  /**
   * Abaixo disso o histórico de feedback é ruído estatístico e NÃO deve
   * influenciar o ranking. Evita que um único 👎 acidental enterre uma regra.
   */
  MIN_SAMPLES_FOR_RANKING_SIGNAL: 3,
} as const;

// ---------------------------------------------------------------------------
// Fórmulas puras
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/**
 * Peso de um evento de feedback.
 *
 * É função PURA da linha de recuperação (rank + score) e NÃO do valor do
 * feedback. Essa escolha é o que torna a reversão exata: ao trocar 👍→👎,
 * o mesmo peso é subtraído de um lado e somado ao outro, sem precisar
 * consultar o histórico do evento anterior.
 */
export function computeEventWeight(
  rank: number | null | undefined,
  finalScore: number | null | undefined,
): number {
  const r = Math.max(1, Number.isFinite(Number(rank)) ? Number(rank) : 3);
  const s = clamp(Number.isFinite(Number(finalScore)) ? Number(finalScore) : 50, 0, 100);

  const rankWeight = Math.max(
    COACH_FEEDBACK_POLICY.RANK_WEIGHT_FLOOR,
    1 - COACH_FEEDBACK_POLICY.RANK_DECAY_PER_POSITION * (r - 1),
  );
  const scoreWeight =
    COACH_FEEDBACK_POLICY.SCORE_WEIGHT_BASE +
    COACH_FEEDBACK_POLICY.SCORE_WEIGHT_RANGE * (s / 100);

  return round(
    clamp(
      rankWeight * scoreWeight,
      COACH_FEEDBACK_POLICY.EVENT_WEIGHT_MIN,
      COACH_FEEDBACK_POLICY.EVENT_WEIGHT_MAX,
    ),
    4,
  );
}

/** Média bayesiana das avaliações ponderadas. Sem amostras → 0.5 (neutro). */
export function computeSuccessRate(
  positiveWeight: number,
  negativeWeight: number,
): number {
  const p = Math.max(0, Number(positiveWeight) || 0);
  const n = Math.max(0, Number(negativeWeight) || 0);
  const { PRIOR_ALPHA, PRIOR_BETA } = COACH_FEEDBACK_POLICY;
  return round((p + PRIOR_ALPHA) / (p + n + PRIOR_ALPHA + PRIOR_BETA), 4);
}

/** Confiança derivada — nunca incremental. Ver nota de projeto no topo. */
export function computeConfidence(successRate: number, sampleCount: number): number {
  const {
    BASE_CONFIDENCE,
    CONFIDENCE_SPREAD,
    SAMPLE_SMOOTHING,
    MIN_CONFIDENCE,
    MAX_CONFIDENCE,
  } = COACH_FEEDBACK_POLICY;

  const sr = Number.isFinite(successRate) ? successRate : 0.5;
  const n = Math.max(0, Number(sampleCount) || 0);
  const damping = n / (n + SAMPLE_SMOOTHING);

  return round(
    clamp(
      BASE_CONFIDENCE + (sr - 0.5) * CONFIDENCE_SPREAD * damping,
      MIN_CONFIDENCE,
      MAX_CONFIDENCE,
    ),
    3,
  );
}

// ---------------------------------------------------------------------------
// Projeção de transição — usada em testes e para prever o efeito na UI.
// ---------------------------------------------------------------------------

export interface FeedbackCounters {
  positiveCount: number;
  negativeCount: number;
  positiveWeight: number;
  negativeWeight: number;
}

export interface FeedbackProjection extends FeedbackCounters {
  sampleCount: number;
  successRate: number;
  confidence: number;
}

export const EMPTY_FEEDBACK_COUNTERS: FeedbackCounters = {
  positiveCount: 0,
  negativeCount: 0,
  positiveWeight: 0,
  negativeWeight: 0,
};

/**
 * Aplica uma transição de feedback sobre contadores — mesma aritmética da
 * RPC. Reverte o voto anterior antes de aplicar o novo, então a sequência
 * 👍 → 👎 → 👍 devolve exatamente o estado após o primeiro 👍.
 */
export function projectFeedbackTransition(
  current: FeedbackCounters,
  previous: CoachFeedbackStatus,
  next: CoachFeedbackStatus,
  eventWeight: number,
): FeedbackProjection {
  let { positiveCount, negativeCount, positiveWeight, negativeWeight } = current;
  const w = eventWeight;

  if (previous === "positive") {
    positiveCount = Math.max(0, positiveCount - 1);
    positiveWeight = Math.max(0, round(positiveWeight - w, 4));
  } else if (previous === "negative") {
    negativeCount = Math.max(0, negativeCount - 1);
    negativeWeight = Math.max(0, round(negativeWeight - w, 4));
  }

  if (next === "positive") {
    positiveCount += 1;
    positiveWeight = round(positiveWeight + w, 4);
  } else if (next === "negative") {
    negativeCount += 1;
    negativeWeight = round(negativeWeight + w, 4);
  }

  const sampleCount = positiveCount + negativeCount;
  const successRate = computeSuccessRate(positiveWeight, negativeWeight);

  return {
    positiveCount,
    negativeCount,
    positiveWeight,
    negativeWeight,
    sampleCount,
    successRate,
    confidence: computeConfidence(successRate, sampleCount),
  };
}

// ---------------------------------------------------------------------------
// Sinal de ranking (consumido pelo retriever da Fase 3)
// ---------------------------------------------------------------------------

export interface FeedbackRankingSignal {
  /** 0..1 — quanto o histórico favorece o aprendizado. */
  quality: number;
  /** 0..1 — quanto o histórico o desfavorece. Alimenta penalização. */
  poorQuality: number;
  /** false quando ainda não há amostras suficientes para opinar. */
  hasEvidence: boolean;
}

export const NEUTRAL_FEEDBACK_SIGNAL: FeedbackRankingSignal = {
  quality: 0,
  poorQuality: 0,
  hasEvidence: false,
};

/**
 * Converte o histórico em sinal de ranking.
 *
 * Regra de projeto: abaixo de MIN_SAMPLES_FOR_RANKING_SIGNAL o retorno é
 * NEUTRO — nem bônus, nem penalização. Um aprendizado novo não pode ser
 * punido apenas por ainda não ter sido avaliado, e um único 👎 não pode
 * removê-lo da recuperação.
 */
export function feedbackRankingSignal(
  successRate: number | null | undefined,
  sampleCount: number | null | undefined,
): FeedbackRankingSignal {
  const n = Math.max(0, Number(sampleCount) || 0);
  if (n < COACH_FEEDBACK_POLICY.MIN_SAMPLES_FOR_RANKING_SIGNAL) {
    return NEUTRAL_FEEDBACK_SIGNAL;
  }
  const sr = clamp(Number(successRate ?? 0.5), 0, 1);

  // 0.5 é neutro; acima vira qualidade, abaixo vira má qualidade.
  // Normalizado para 0..1 e amortecido pela quantidade de amostras.
  const damping = n / (n + COACH_FEEDBACK_POLICY.SAMPLE_SMOOTHING);
  const deviation = (sr - 0.5) * 2;

  return {
    quality: deviation > 0 ? round(deviation * damping, 4) : 0,
    poorQuality: deviation < 0 ? round(-deviation * damping, 4) : 0,
    hasEvidence: true,
  };
}
