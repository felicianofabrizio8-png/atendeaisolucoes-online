// Cobertura da expansão de erros (BLOCO save_failed hotfix):
// - Mapeamento explícito dos códigos emitidos pela RPC create_coach_learning
// - Consumo da resposta estável { ok:false, code, field?, retryable? }
// - Sanitização de mensagens vindas do server (não vazar detalhes técnicos)
import { describe, it, expect } from "vitest";
import { getSafeLearningError } from "../errors";

describe("getSafeLearningError — códigos da RPC create_coach_learning", () => {
  it("mapeia coach_learning_invalid_title com field=title", () => {
    const safe = getSafeLearningError(new Error("coach_learning_invalid_title"));
    expect(safe.code).toBe("coach_learning_invalid_title");
    expect(safe.field).toBe("title");
    expect(safe.message).toMatch(/título/i);
    expect(safe.retryable).toBe(false);
  });

  it("mapeia coach_learning_invalid_rule com field=rule_structured", () => {
    const safe = getSafeLearningError(new Error("coach_learning_invalid_rule"));
    expect(safe.code).toBe("coach_learning_invalid_rule");
    expect(safe.field).toBe("rule_structured");
    expect(safe.message).toMatch(/regra/i);
  });

  it("mapeia coach_learning_invalid_origin", () => {
    const safe = getSafeLearningError(new Error("coach_learning_invalid_origin"));
    expect(safe.code).toBe("coach_learning_invalid_origin");
    expect(safe.field).toBe("origin");
  });

  it("mapeia learning_duplicate_conflict", () => {
    const safe = getSafeLearningError(new Error("learning_duplicate_conflict"));
    expect(safe.code).toBe("learning_duplicate_conflict");
    expect(safe.field).toBe("title");
    expect(safe.message).toMatch(/parecido/i);
  });

  it("mapeia coach_learning_no_company", () => {
    const safe = getSafeLearningError(new Error("coach_learning_no_company"));
    expect(safe.code).toBe("coach_learning_no_company");
    expect(safe.retryable).toBe(false);
  });

  it("mapeia SQLSTATE 23503 sem 'source_conversation' como foreign_key_violation", () => {
    const safe = getSafeLearningError({
      message: "insert violates foreign key constraint (23503)",
      code: "23503",
    });
    expect(safe.code).toBe("foreign_key_violation");
  });

  it("mapeia 23514 como check_violation", () => {
    const safe = getSafeLearningError({ message: "check", code: "23514" });
    expect(safe.code).toBe("check_violation");
  });

  it("mapeia 23505 como duplicate (compat legado)", () => {
    const safe = getSafeLearningError({ message: "dup", code: "23505" });
    expect(safe.code).toBe("duplicate");
  });


  it("prefere code do PostgrestError sobre message", () => {
    const safe = getSafeLearningError({ code: "coach_learning_invalid_title", message: "algo genérico" });
    expect(safe.code).toBe("coach_learning_invalid_title");
  });
});

describe("getSafeLearningError — resposta estável do server", () => {
  it("consome { ok:false, code, field, retryable }", () => {
    const safe = getSafeLearningError({
      ok: false,
      code: "coach_learning_invalid_rule",
      field: "rule_structured",
      retryable: false,
    });
    expect(safe.code).toBe("coach_learning_invalid_rule");
    expect(safe.field).toBe("rule_structured");
    expect(safe.retryable).toBe(false);
  });

  it("ignora message do server contaminada com SQLSTATE", () => {
    const safe = getSafeLearningError({
      ok: false,
      code: "internal",
      message: "SQLSTATE 23514 at coach_learnings",
    });
    // cai no friendly padrão do 'internal'
    expect(safe.message).not.toMatch(/23514/);
    expect(safe.message).not.toMatch(/SQLSTATE/i);
  });

  it("code desconhecido do server degrada para internal", () => {
    const safe = getSafeLearningError({ ok: false, code: "xyz_never_seen" });
    expect(safe.code).toBe("internal");
    expect(safe.message).toMatch(/registrado/i);
  });

  it("nunca renderiza 'save_failed' literal", () => {
    const safe = getSafeLearningError({ ok: false, code: "save_failed" });
    expect(safe.message.toLowerCase()).not.toBe("save_failed");
    expect(safe.message).toMatch(/não foi possível/i);
  });
});

describe("getSafeLearningError — timeout & rede", () => {
  it("mapeia timeout", () => {
    expect(getSafeLearningError(new Error("request timeout")).code).toBe("timeout");
  });
  it("mapeia network hard failure", () => {
    expect(getSafeLearningError(new Error("Failed to fetch")).code).toBe("network");
  });
});
