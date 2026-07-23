// BLOCO 4 — Testes puros de similaridade, thresholds, classificação e gate.
import { describe, expect, it } from "vitest";
import {
  classifyByScore,
  decideSaveGate,
  normalizeForHashPreview,
  SIMILARITY_THRESHOLDS,
  type SimilarCandidate,
} from "../similarity";
import {
  clampGroundingLimit,
  COACH_GROUNDING_DEFAULT_LIMIT,
  COACH_GROUNDING_MAX_LIMIT,
  STATUS_LABEL_PT,
} from "../schema";

function candidate(over: Partial<SimilarCandidate>): SimilarCandidate {
  return {
    id: "l1",
    version: 1,
    status: "active",
    category: "objection",
    title: "t",
    description: "d",
    rule_structured: "r",
    product_ref: null,
    priority: 50,
    updated_at: new Date().toISOString(),
    content_hash: "hash",
    score: 0,
    classification: "new",
    ...over,
  };
}

describe("BLOCO 4 · thresholds & classifyByScore", () => {
  it("exato vence qualquer score quando isExactHash=true", () => {
    expect(classifyByScore(0, true)).toBe("exact");
    expect(classifyByScore(0.99, true)).toBe("exact");
  });

  it("acima de HIGH → highly_similar", () => {
    expect(classifyByScore(SIMILARITY_THRESHOLDS.HIGH, false)).toBe("highly_similar");
    expect(classifyByScore(0.9, false)).toBe("highly_similar");
  });

  it("entre RELATED e HIGH → related", () => {
    expect(classifyByScore(SIMILARITY_THRESHOLDS.RELATED, false)).toBe("related");
    expect(classifyByScore(0.6, false)).toBe("related");
  });

  it("abaixo de RELATED → new", () => {
    expect(classifyByScore(0.1, false)).toBe("new");
    expect(classifyByScore(SIMILARITY_THRESHOLDS.RELATED - 0.01, false)).toBe("new");
  });
});

describe("BLOCO 4 · decideSaveGate", () => {
  it("exato → block_exact (não permite criação silenciosa)", () => {
    const g = decideSaveGate([candidate({ classification: "exact" })]);
    expect(g.gate).toBe("block_exact");
    expect(g.exact?.id).toBe("l1");
    expect(g.similar).toHaveLength(0);
  });

  it("highly_similar sem exato → confirm_similar", () => {
    const g = decideSaveGate([candidate({ classification: "highly_similar", score: 0.8 })]);
    expect(g.gate).toBe("confirm_similar");
    expect(g.exact).toBeNull();
    expect(g.similar).toHaveLength(1);
  });

  it("apenas related → confirm_similar (usuário decide)", () => {
    const g = decideSaveGate([candidate({ classification: "related", score: 0.5 })]);
    expect(g.gate).toBe("confirm_similar");
  });

  it("apenas new → proceed", () => {
    const g = decideSaveGate([candidate({ classification: "new", score: 0.1 })]);
    expect(g.gate).toBe("proceed");
  });

  it("lista vazia → proceed", () => {
    expect(decideSaveGate([]).gate).toBe("proceed");
  });

  it("exato prevalece sobre highly_similar na mesma lista", () => {
    const g = decideSaveGate([
      candidate({ id: "a", classification: "highly_similar", score: 0.85 }),
      candidate({ id: "b", classification: "exact" }),
    ]);
    expect(g.gate).toBe("block_exact");
    expect(g.exact?.id).toBe("b");
  });
});

describe("BLOCO 4 · normalização (preview client-side do content_hash)", () => {
  it("trim, lowercase, remove acentos e pontuação, colapsa espaços", () => {
    expect(normalizeForHashPreview("  Vou VERIFICAR!!  a piscina Àguà  ")).toBe(
      "vou verificar a piscina agua",
    );
  });

  it("normaliza igualmente diferenças de caixa e espaços múltiplos", () => {
    expect(normalizeForHashPreview("Piscina  Fibra")).toBe(
      normalizeForHashPreview("piscina fibra"),
    );
  });

  it("null/undefined → string vazia (compatível com hash NULL-safe do banco)", () => {
    expect(normalizeForHashPreview(null)).toBe("");
    expect(normalizeForHashPreview(undefined)).toBe("");
  });
});

describe("BLOCO 4 · limite de grounding", () => {
  it("default é 5 e máximo é 10", () => {
    expect(COACH_GROUNDING_DEFAULT_LIMIT).toBe(5);
    expect(COACH_GROUNDING_MAX_LIMIT).toBe(10);
  });

  it("clampGroundingLimit respeita [1, 10]", () => {
    expect(clampGroundingLimit(0)).toBe(1);
    expect(clampGroundingLimit(-3)).toBe(1);
    expect(clampGroundingLimit(5)).toBe(5);
    expect(clampGroundingLimit(20)).toBe(10);
    expect(clampGroundingLimit(null)).toBe(COACH_GROUNDING_DEFAULT_LIMIT);
    expect(clampGroundingLimit(undefined)).toBe(COACH_GROUNDING_DEFAULT_LIMIT);
    expect(clampGroundingLimit(Number.NaN)).toBe(COACH_GROUNDING_DEFAULT_LIMIT);
  });
});

describe("BLOCO 4 · rótulos oficiais de status DB↔UI", () => {
  it("active → Ativo, paused → Inativo, archived → Arquivado", () => {
    expect(STATUS_LABEL_PT.active).toBe("Ativo");
    expect(STATUS_LABEL_PT.paused).toBe("Inativo");
    expect(STATUS_LABEL_PT.archived).toBe("Arquivado");
  });
});
