// ============================================================================
// SPRINT 4 · FASE 4 — Política de feedback e ajuste de confiança
//
// Estes testes cobrem as três propriedades que sustentam o desenho:
//   1. IDEMPOTÊNCIA      — reaplicar o mesmo estado não altera nada.
//   2. REVERSIBILIDADE   — 👍→👎→👍 volta exatamente ao estado original.
//   3. GRADUALIDADE      — uma avaliação isolada quase não move a confiança.
//
// E uma guarda estrutural: as constantes daqui precisam existir literalmente
// na migration SQL, senão TS e banco divergem silenciosamente.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  COACH_FEEDBACK_POLICY,
  EMPTY_FEEDBACK_COUNTERS,
  computeConfidence,
  computeEventWeight,
  computeSuccessRate,
  feedbackRankingSignal,
  projectFeedbackTransition,
  type FeedbackCounters,
} from "../feedback-policy";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Aplica uma sequência de votos, sempre com o mesmo peso de evento. */
function applySequence(
  votes: Array<"positive" | "negative" | null>,
  weight = 1,
): { counters: FeedbackCounters; confidence: number; successRate: number } {
  let counters: FeedbackCounters = { ...EMPTY_FEEDBACK_COUNTERS };
  let previous: "positive" | "negative" | null = null;
  let confidence: number = COACH_FEEDBACK_POLICY.BASE_CONFIDENCE;
  let successRate: number = 0.5;

  for (const vote of votes) {
    const p = projectFeedbackTransition(counters, previous, vote, weight);
    counters = {
      positiveCount: p.positiveCount,
      negativeCount: p.negativeCount,
      positiveWeight: p.positiveWeight,
      negativeWeight: p.negativeWeight,
    };
    confidence = p.confidence;
    successRate = p.successRate;
    previous = vote;
  }
  return { counters, confidence, successRate };
}

// ---------------------------------------------------------------------------
// 1. Peso do evento
// ---------------------------------------------------------------------------
describe("computeEventWeight", () => {
  it("dá mais peso ao aprendizado melhor posicionado na recuperação", () => {
    const top = computeEventWeight(1, 90);
    const bottom = computeEventWeight(5, 90);
    expect(top).toBeGreaterThan(bottom);
  });

  it("dá mais peso quando o score de relevância foi alto", () => {
    expect(computeEventWeight(1, 100)).toBeGreaterThan(computeEventWeight(1, 0));
  });

  it("respeita os limites duros em entradas extremas", () => {
    for (const [rank, score] of [
      [1, 100],
      [99, 0],
      [-5, 500],
      [1, -100],
    ] as const) {
      const w = computeEventWeight(rank, score);
      expect(w).toBeGreaterThanOrEqual(COACH_FEEDBACK_POLICY.EVENT_WEIGHT_MIN);
      expect(w).toBeLessThanOrEqual(COACH_FEEDBACK_POLICY.EVENT_WEIGHT_MAX);
    }
  });

  it("usa um peso neutro quando não há trace de recuperação (fallback legado)", () => {
    const w = computeEventWeight(null, null);
    expect(w).toBeGreaterThan(0.5);
    expect(w).toBeLessThan(1.25);
  });

  it("é puro: não depende do valor do feedback, o que garante reversão exata", () => {
    // O mesmo (rank, score) SEMPRE devolve o mesmo peso — é isso que permite
    // subtrair de um lado e somar no outro sem consultar o histórico.
    expect(computeEventWeight(2, 70)).toBe(computeEventWeight(2, 70));
  });
});

// ---------------------------------------------------------------------------
// 2. Taxa de sucesso
// ---------------------------------------------------------------------------
describe("computeSuccessRate", () => {
  it("parte de 0.5 (neutro) sem nenhuma avaliação", () => {
    expect(computeSuccessRate(0, 0)).toBe(0.5);
  });

  it("não deixa uma única avaliação virar veredito absoluto", () => {
    // Sem prior bayesiano, 1 positivo daria 1.0 e 1 negativo daria 0.0.
    expect(computeSuccessRate(1, 0)).toBe(0.6);
    expect(computeSuccessRate(0, 1)).toBe(0.4);
  });

  it("converge para os extremos apenas com volume", () => {
    expect(computeSuccessRate(50, 0)).toBeGreaterThan(0.9);
    expect(computeSuccessRate(0, 50)).toBeLessThan(0.1);
  });

  it("permanece sempre dentro de [0,1], inclusive com entrada inválida", () => {
    for (const [p, n] of [
      [-10, -10],
      [0, 0],
      [1e6, 0],
      [0, 1e6],
    ] as const) {
      const sr = computeSuccessRate(p, n);
      expect(sr).toBeGreaterThanOrEqual(0);
      expect(sr).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Confiança — gradualidade e limites
// ---------------------------------------------------------------------------
describe("computeConfidence", () => {
  it("sem avaliações permanece na confiança base", () => {
    expect(computeConfidence(0.5, 0)).toBe(COACH_FEEDBACK_POLICY.BASE_CONFIDENCE);
  });

  it("uma única avaliação negativa quase não move a confiança", () => {
    const after = computeConfidence(computeSuccessRate(0, 1), 1);
    const delta = COACH_FEEDBACK_POLICY.BASE_CONFIDENCE - after;
    expect(delta).toBeGreaterThan(0); // houve efeito...
    expect(delta).toBeLessThan(0.03); // ...mas é marginal
  });

  it("evidência acumulada de 👎 rebaixa a confiança de forma relevante", () => {
    const one = computeConfidence(computeSuccessRate(0, 1), 1);
    const ten = computeConfidence(computeSuccessRate(0, 10), 10);
    const fifty = computeConfidence(computeSuccessRate(0, 50), 50);
    expect(ten).toBeLessThan(one);
    expect(fifty).toBeLessThan(ten);
    expect(fifty).toBeLessThan(0.4);
  });

  it("nunca ultrapassa os limites duros, nem sob evidência massiva", () => {
    const worst = computeConfidence(computeSuccessRate(0, 100_000), 100_000);
    const best = computeConfidence(computeSuccessRate(100_000, 0), 100_000);
    expect(worst).toBeGreaterThanOrEqual(COACH_FEEDBACK_POLICY.MIN_CONFIDENCE);
    expect(best).toBeLessThanOrEqual(COACH_FEEDBACK_POLICY.MAX_CONFIDENCE);
  });

  it("um único 👎 jamais é capaz de invalidar uma regra", () => {
    // Requisito explícito de negócio: nada de morte súbita por um clique.
    expect(computeConfidence(computeSuccessRate(0, 1), 1)).toBeGreaterThan(0.6);
  });

  it("é monotônica: mais positivos nunca reduzem a confiança", () => {
    let prev = -Infinity;
    for (let n = 0; n <= 30; n += 1) {
      const c = computeConfidence(computeSuccessRate(n, 0), n);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Transições — idempotência e reversibilidade
// ---------------------------------------------------------------------------
describe("projectFeedbackTransition", () => {
  it("👍 incrementa apenas o lado positivo", () => {
    const p = projectFeedbackTransition(EMPTY_FEEDBACK_COUNTERS, null, "positive", 1);
    expect(p.positiveCount).toBe(1);
    expect(p.negativeCount).toBe(0);
    expect(p.sampleCount).toBe(1);
    expect(p.confidence).toBeGreaterThan(COACH_FEEDBACK_POLICY.BASE_CONFIDENCE);
  });

  it("trocar 👍 para 👎 remove o impacto anterior em vez de somar os dois", () => {
    const first = projectFeedbackTransition(EMPTY_FEEDBACK_COUNTERS, null, "positive", 1);
    const second = projectFeedbackTransition(first, "positive", "negative", 1);

    expect(second.positiveCount).toBe(0); // o 👍 foi desfeito
    expect(second.negativeCount).toBe(1);
    expect(second.sampleCount).toBe(1); // NÃO virou 2 amostras
  });

  it("👍→👎→👍 retorna exatamente ao estado do primeiro 👍", () => {
    // Reversibilidade perfeita: a confiança é função dos contadores,
    // então não existe deriva residual do caminho percorrido.
    const direct = applySequence(["positive"]);
    const roundTrip = applySequence(["positive", "negative", "positive"]);
    expect(roundTrip.counters).toEqual(direct.counters);
    expect(roundTrip.confidence).toBe(direct.confidence);
    expect(roundTrip.successRate).toBe(direct.successRate);
  });

  it("remover a avaliação restaura o estado neutro original", () => {
    const cleared = applySequence(["negative", null]);
    expect(cleared.counters).toEqual(EMPTY_FEEDBACK_COUNTERS);
    expect(cleared.confidence).toBe(COACH_FEEDBACK_POLICY.BASE_CONFIDENCE);
  });

  it("não gera contadores negativos se a reversão chegar sem estado prévio", () => {
    const p = projectFeedbackTransition(EMPTY_FEEDBACK_COUNTERS, "positive", "negative", 1);
    expect(p.positiveCount).toBe(0);
    expect(p.positiveWeight).toBe(0);
  });

  it("é idempotente: o mesmo estado reprojetado produz o mesmo resultado", () => {
    const a = applySequence(["positive", "positive", "positive"]);
    const b = applySequence(["positive"]);
    // Cada aplicação reverte a anterior, então três 👍 seguidos equivalem a um.
    expect(a.counters).toEqual(b.counters);
    expect(a.confidence).toBe(b.confidence);
  });

  it("não sofre deriva numérica ao longo de muitas alternâncias", () => {
    const votes: Array<"positive" | "negative"> = [];
    for (let i = 0; i < 500; i += 1) votes.push(i % 2 === 0 ? "positive" : "negative");
    const result = applySequence(votes);
    // Termina em 👎 → exatamente 1 amostra negativa acumulada.
    expect(result.counters.positiveCount).toBe(0);
    expect(result.counters.negativeCount).toBe(1);
    expect(result.counters.positiveWeight).toBe(0);
  });

  it("aprendizado no topo do ranking sofre mais impacto que um marginal", () => {
    const top = projectFeedbackTransition(
      EMPTY_FEEDBACK_COUNTERS,
      null,
      "negative",
      computeEventWeight(1, 95),
    );
    const marginal = projectFeedbackTransition(
      EMPTY_FEEDBACK_COUNTERS,
      null,
      "negative",
      computeEventWeight(5, 20),
    );
    expect(top.confidence).toBeLessThan(marginal.confidence);
  });
});

// ---------------------------------------------------------------------------
// 5. Sinal de ranking
// ---------------------------------------------------------------------------
describe("feedbackRankingSignal", () => {
  it("é neutro enquanto não houver amostras suficientes", () => {
    // Um aprendizado novo não pode ser punido por ainda não ter sido avaliado.
    for (let n = 0; n < COACH_FEEDBACK_POLICY.MIN_SAMPLES_FOR_RANKING_SIGNAL; n += 1) {
      const s = feedbackRankingSignal(0.05, n);
      expect(s.hasEvidence).toBe(false);
      expect(s.quality).toBe(0);
      expect(s.poorQuality).toBe(0);
    }
  });

  it("um único 👎 nunca chega a penalizar o ranking", () => {
    expect(feedbackRankingSignal(computeSuccessRate(0, 1), 1).poorQuality).toBe(0);
  });

  it("histórico bom vira bônus e histórico ruim vira penalização", () => {
    const good = feedbackRankingSignal(computeSuccessRate(20, 0), 20);
    const bad = feedbackRankingSignal(computeSuccessRate(0, 20), 20);

    expect(good.quality).toBeGreaterThan(0);
    expect(good.poorQuality).toBe(0);
    expect(bad.poorQuality).toBeGreaterThan(0);
    expect(bad.quality).toBe(0);
  });

  it("desempenho equilibrado não empurra o ranking para nenhum lado", () => {
    const s = feedbackRankingSignal(computeSuccessRate(10, 10), 20);
    expect(s.quality).toBeLessThan(0.05);
    expect(s.poorQuality).toBeLessThan(0.05);
  });

  it("mantém os sinais normalizados em 0..1", () => {
    const s = feedbackRankingSignal(0, 10_000);
    expect(s.poorQuality).toBeLessThanOrEqual(1);
    expect(s.quality).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Guarda anti-divergência TS ⇄ SQL
// ---------------------------------------------------------------------------
describe("paridade entre a política em TypeScript e a do banco", () => {
  /** Concatena todas as migrations — a fórmula vive em uma delas. */
  function readMigrations(): string {
    const dir = join(process.cwd(), "supabase", "migrations");
    return readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
  }

  it("as constantes numéricas da política existem literalmente no SQL", () => {
    // A aplicação real das métricas acontece na RPC. Se alguém ajustar a
    // curva de um lado só, TS e banco passam a discordar silenciosamente e
    // o ranking deixa de refletir a confiança persistida. Este teste falha
    // antes disso acontecer.
    const sql = readMigrations();
    expect(sql).toContain("coach_feedback_confidence");
    expect(sql).toContain("coach_feedback_success_rate");
    expect(sql).toContain("coach_feedback_event_weight");

    const required = [
      "0.700", // BASE_CONFIDENCE
      "0.900", // CONFIDENCE_SPREAD
      "5.0", // SAMPLE_SMOOTHING
      "0.150", // MIN_CONFIDENCE
      "0.950", // MAX_CONFIDENCE
      "2.0", // PRIOR_ALPHA
      "4.0", // ALPHA + BETA
      "0.08", // RANK_DECAY_PER_POSITION
      "0.60", // RANK_WEIGHT_FLOOR
      "0.80", // SCORE_WEIGHT_BASE
      "0.40", // SCORE_WEIGHT_RANGE
      "1.25", // EVENT_WEIGHT_MAX
    ];
    for (const literal of required) {
      expect(sql, `constante ${literal} ausente na migration`).toContain(literal);
    }
  });

  it("a versão v2 da RPC deriva o tenant de auth.uid(), nunca do cliente", () => {
    const sql = readMigrations();
    expect(sql).toContain("submit_coach_suggestion_feedback_v2");
    expect(sql).toContain("coach_feedback_cross_tenant");
    // Nenhum parâmetro de empresa é aceito na assinatura.
    expect(sql).not.toContain("submit_coach_suggestion_feedback_v2(_suggestion_id uuid, _company_id");
  });
});
