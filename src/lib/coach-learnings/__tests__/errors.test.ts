// BLOCO 1 — Cobertura de getSafeLearningError + validateLearningDraft.
import { describe, expect, it } from "vitest";
import {
  getSafeLearningError,
  validateLearningDraft,
  hasValidationErrors,
} from "../errors";
import { COACH_LEARNING_CATEGORIES } from "../schema";

describe("getSafeLearningError", () => {
  it("mapeia código de duplicidade do Postgres", () => {
    const err = getSafeLearningError(new Error("duplicate key value violates unique constraint (23505)"));
    expect(err.code).toBe("duplicate");
    expect(err.message).toMatch(/já existe/i);
    expect(err.retryable).toBe(false);
  });

  it("mapeia permissão negada RLS", () => {
    const err = getSafeLearningError(new Error("permission denied for table"));
    expect(err.code).toBe("unauthorized");
    expect(err.retryable).toBe(false);
  });

  it("mapeia erro de rede", () => {
    const err = getSafeLearningError(new Error("Failed to fetch"));
    expect(err.code).toBe("network");
    expect(err.hint).toMatch(/conexão/i);
    expect(err.retryable).toBe(true);
  });

  it("mapeia input inválido", () => {
    const err = getSafeLearningError(new Error("teach_mode_schema_invalid"));
    expect(err.code).toBe("input_invalid");
  });

  it("mapeia no_company", () => {
    const err = getSafeLearningError("no_company");
    expect(err.code).toBe("no_company");
    expect(err.retryable).toBe(false);
  });

  it("mapeia save_failed cru para mensagem amigável", () => {
    const err = getSafeLearningError(new Error("save_failed"));
    expect(err.code).toBe("save_failed");
    expect(err.message).not.toBe("save_failed");
    expect(err.message).toMatch(/não foi possível/i);
    expect(err.retryable).toBe(true);
  });

  it("cai em internal para erros desconhecidos", () => {
    const err = getSafeLearningError(new Error("something exploded"));
    expect(err.code).toBe("internal");
    expect(err.message).toMatch(/inesperado/i);
  });

  it("nunca expõe a mensagem bruta do erro", () => {
    const raw = "stack trace: /server/leak.ts:42:0";
    const err = getSafeLearningError(new Error(raw));
    expect(err.message.includes(raw)).toBe(false);
  });

  it("aceita erros não-Error sem quebrar", () => {
    expect(getSafeLearningError(null).code).toBe("internal");
    expect(getSafeLearningError(undefined).code).toBe("internal");
    expect(getSafeLearningError({ message: "duplicate key" }).code).toBe("duplicate");
  });
});

describe("validateLearningDraft", () => {
  const base = {
    title: "Reconhecer clientes que comparam propostas",
    description: "Quando o cliente diz que tem outros orçamentos, valide antes de responder.",
    rule_structured: "Reconhecer, validar, apresentar diferenciais, não desmerecer concorrentes.",
    category: COACH_LEARNING_CATEGORIES[0],
    priority: 50,
    allowedCategories: COACH_LEARNING_CATEGORIES,
  };

  it("aceita rascunho válido", () => {
    const v = validateLearningDraft(base);
    expect(hasValidationErrors(v)).toBe(false);
  });

  it("rejeita título vazio", () => {
    const v = validateLearningDraft({ ...base, title: "  " });
    expect(v.title).toMatch(/título/i);
    expect(hasValidationErrors(v)).toBe(true);
  });

  it("rejeita descrição vazia", () => {
    const v = validateLearningDraft({ ...base, description: "" });
    expect(v.description).toMatch(/descreva/i);
  });

  it("rejeita regra estruturada vazia", () => {
    const v = validateLearningDraft({ ...base, rule_structured: "  " });
    expect(v.rule_structured).toBeDefined();
  });

  it("rejeita categoria inválida", () => {
    const v = validateLearningDraft({ ...base, category: "invalida" });
    expect(v.category).toMatch(/categoria/i);
  });

  it("rejeita prioridade fora do intervalo", () => {
    expect(validateLearningDraft({ ...base, priority: -1 }).priority).toBeDefined();
    expect(validateLearningDraft({ ...base, priority: 101 }).priority).toBeDefined();
  });

  it("rejeita título gigante", () => {
    const v = validateLearningDraft({ ...base, title: "x".repeat(121) });
    expect(v.title).toMatch(/120/);
  });
});
