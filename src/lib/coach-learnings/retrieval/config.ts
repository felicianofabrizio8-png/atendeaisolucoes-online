// ============================================================================
// Coach Evolutivo — Configuração do ranking contextual (SPRINT 4 · FASE 3)
//
// FONTE ÚNICA DE VERDADE dos limites e pesos. Nenhum número mágico deve ser
// duplicado em retriever, grounding, rota ou testes: tudo importa daqui.
// ============================================================================

/** Estratégia de recuperação registrada no trace. */
export type CoachRetrievalStrategy = "contextual_v1" | "static_fallback";

/** Limites operacionais da recuperação. */
export const COACH_RETRIEVAL_LIMITS = {
  /** Quantos aprendizados ativos são carregados do banco para ranquear. */
  MAX_CANDIDATES: 50,
  /** Quantos podem, no máximo, entrar no prompt. Não é uma cota a preencher. */
  MAX_SELECTED: 5,
  /** Teto de caracteres do bloco de aprendizados injetado no grounding. */
  MAX_CONTEXT_CHARACTERS: 3500,
  /** Score mínimo (0..100) para um aprendizado ser considerado relevante. */
  MIN_RELEVANCE_SCORE: 18,
  /** Quantas mensagens recentes entram no contexto (além da atual). */
  MAX_RECENT_MESSAGES: 6,
  /** Teto de caracteres por mensagem considerada. */
  MAX_MESSAGE_CHARACTERS: 600,
  /**
   * Similaridade de Jaccard acima da qual dois selecionados são tratados
   * como quase-duplicados — o de menor score é descartado.
   */
  NEAR_DUPLICATE_THRESHOLD: 0.72,
} as const;

/**
 * Pesos do score. Cada sinal contribui com no máximo o seu peso, e o total é
 * normalizado para 0..100. Regras de projeto embutidas aqui:
 *
 *  - `manualPriority` e `usageHistory` são deliberadamente FRACOS: prioridade
 *    alta ou uso frequente jamais podem, sozinhos, levar um aprendizado
 *    irrelevante ao topo (requisito 5.D e 5.F).
 *  - `currentMessage*` pesa muito mais que `recentContextMatch`: a pergunta
 *    atual manda (requisito 5.G).
 *  - Penalizações são negativas e aplicadas após a soma dos sinais.
 */
export const COACH_LEARNING_RANKING_WEIGHTS = {
  // --- Correspondência lexical (mensagem atual) ---------------------------
  titleMatch: 14,
  triggerMatch: 16,
  contentMatch: 18,
  // --- Sinais estruturais -------------------------------------------------
  productMatch: 16,
  intentMatch: 20,
  categoryMatch: 6,
  // --- Contexto e histórico (fracos por definição) ------------------------
  recentContextMatch: 7,
  manualPriority: 6,
  confidence: 4,
  historicalSuccess: 3,
  recency: 2,
  specificity: 5,
  // --- Penalizações (valores negativos) -----------------------------------
  genericPenalty: -6,
  noContextPenalty: -10,
  unsafeInstructionPenalty: -60,
} as const;

export type CoachRankingWeightKey = keyof typeof COACH_LEARNING_RANKING_WEIGHTS;

/** Soma dos pesos positivos — base da normalização para 0..100. */
export const COACH_RANKING_POSITIVE_TOTAL = Object.values(
  COACH_LEARNING_RANKING_WEIGHTS,
).reduce((acc, w) => (w > 0 ? acc + w : acc), 0);

/** Motivos positivos possíveis (allowlist — nunca texto livre). */
export const COACH_MATCH_REASONS = [
  "title_keyword_match",
  "trigger_keyword_match",
  "content_keyword_match",
  "product_match",
  "intent_match",
  "category_match",
  "recent_context_match",
  "manual_priority",
  "high_confidence",
  "historical_success",
  "recently_used",
  "high_specificity",
] as const;
export type CoachMatchReason = (typeof COACH_MATCH_REASONS)[number];

/** Penalizações possíveis (allowlist). */
export const COACH_PENALTY_REASONS = [
  "low_specificity",
  "no_context_overlap",
  "unsafe_instruction_pattern",
  "near_duplicate",
  "context_budget_exceeded",
] as const;
export type CoachPenaltyReason = (typeof COACH_PENALTY_REASONS)[number];

/** Motivos de descarte (allowlist). */
export const COACH_DISCARD_REASONS = [
  "below_min_score",
  "over_selection_limit",
  "near_duplicate",
  "unsafe_instruction_pattern",
  "context_budget_exceeded",
] as const;
export type CoachDiscardReason = (typeof COACH_DISCARD_REASONS)[number];

/** Motivos de acionamento do fallback estático (allowlist). */
export const COACH_FALLBACK_REASONS = [
  "empty_context",
  "no_candidate_above_min_score",
  "ranking_error",
] as const;
export type CoachFallbackReason = (typeof COACH_FALLBACK_REASONS)[number];
