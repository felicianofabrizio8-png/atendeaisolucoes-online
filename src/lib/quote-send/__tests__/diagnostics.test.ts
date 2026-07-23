import { describe, it, expect, beforeEach } from "vitest";
import { qsCode, isDiagnosticsEnabled, __resetDiagnosticsCacheForTest } from "../diagnostics";

describe("qsCode", () => {
  it("deriva referência curta do attemptId (últimos 8 alfanuméricos, uppercase)", () => {
    expect(qsCode("qs_mrxo471o_776c5e77")).toBe("QS-776C5E77");
  });
  it("cai para QS-UNKNOWN quando attemptId ausente", () => {
    expect(qsCode(undefined)).toBe("QS-UNKNOWN");
    expect(qsCode(null)).toBe("QS-UNKNOWN");
    expect(qsCode("")).toBe("QS-UNKNOWN");
  });
  it("não expõe o attemptId técnico completo", () => {
    const code = qsCode("qs_mrxo471o_776c5e77");
    expect(code).not.toContain("qs_");
    expect(code).not.toContain("mrxo471o");
  });
  it("tolera attemptId sem underscore", () => {
    expect(qsCode("ABCDEF1234")).toBe("QS-CDEF1234");
  });
});

describe("isDiagnosticsEnabled", () => {
  beforeEach(() => __resetDiagnosticsCacheForTest());
  it("padrão desligado quando flag ausente", () => {
    delete (globalThis as { __QUOTE_SEND_DIAGNOSTICS__?: boolean }).__QUOTE_SEND_DIAGNOSTICS__;
    expect(isDiagnosticsEnabled()).toBe(false);
  });
  it("ligado via override global (mecanismo de teste/preview)", () => {
    (globalThis as { __QUOTE_SEND_DIAGNOSTICS__?: boolean }).__QUOTE_SEND_DIAGNOSTICS__ = true;
    __resetDiagnosticsCacheForTest();
    expect(isDiagnosticsEnabled()).toBe(true);
    delete (globalThis as { __QUOTE_SEND_DIAGNOSTICS__?: boolean }).__QUOTE_SEND_DIAGNOSTICS__;
  });
});
