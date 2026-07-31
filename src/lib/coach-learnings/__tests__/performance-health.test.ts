// SPRINT 4 · FASE 5 — Testes do classificador de saúde e utilitários do painel.
import { describe, it, expect } from "vitest";
import {
  classifyLearningHealth,
  HEALTH_PRESENTATION,
  COACH_LEARNING_HEALTH_CODES,
  healthLabel,
} from "../performance/health";
import {
  formatPercent,
  percentAriaLabel,
  maskId,
  normalizeSort,
  periodToFromIso,
  PerformanceQuerySchema,
  DEFAULT_PAGE_SIZE,
} from "../performance/types";

const base = {
  status: "active",
  confidence: 0.8,
  success_rate: 0.7,
  feedback_sample_count: 10,
  negative_feedback_count: 1,
  usage_count: 5,
  times_retrieved: 8,
};

describe("classifyLearningHealth", () => {
  it("classifica aprendizado saudável", () => {
    expect(classifyLearningHealth(base)).toBe("healthy");
  });

  it("prioriza status arquivado/pausado sobre métricas", () => {
    expect(classifyLearningHealth({ ...base, status: "archived" })).toBe("archived");
    expect(classifyLearningHealth({ ...base, status: "paused" })).toBe("paused");
  });

  it("marca ausência de evidência quando nunca foi recuperado", () => {
    const r = classifyLearningHealth({
      ...base,
      usage_count: 0,
      times_retrieved: 0,
      feedback_sample_count: 0,
    });
    expect(["no_evidence", "never_used"]).toContain(r);
  });

  it("marca baixa confiança", () => {
    const r = classifyLearningHealth({ ...base, confidence: 0.15 });
    expect(r).not.toBe("healthy");
  });

  it("marca histórico negativo", () => {
    const r = classifyLearningHealth({
      ...base,
      success_rate: 0.1,
      negative_feedback_count: 8,
    });
    expect(r).not.toBe("healthy");
  });

  it("é determinístico para a mesma entrada", () => {
    expect(classifyLearningHealth(base)).toBe(classifyLearningHealth({ ...base }));
  });

  it("possui apresentação para todos os códigos", () => {
    for (const code of COACH_LEARNING_HEALTH_CODES) {
      expect(HEALTH_PRESENTATION[code]).toBeDefined();
      expect(HEALTH_PRESENTATION[code].label.length).toBeGreaterThan(0);
    }
  });

  it("healthLabel não quebra com código desconhecido", () => {
    expect(typeof healthLabel("codigo_inexistente")).toBe("string");
  });
});

describe("utilitários de formatação", () => {
  it("formata percentuais e trata ausência de dados", () => {
    expect(formatPercent(0.5)).toBe("50%");
    expect(formatPercent(0.1234, 1)).toBe("12.3%");
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
  });

  it("gera rótulo acessível", () => {
    expect(percentAriaLabel(0.5)).toContain("50");
    expect(percentAriaLabel(null)).toBe("sem dados");
  });

  it("mascara identificadores (sem PII)", () => {
    const id = "3a7e989c-2e1c-425d-8fc6-0feecbeb48fd";
    const masked = maskId(id);
    expect(masked.length).toBeLessThan(id.length);
    expect(masked.startsWith("3a7e989c")).toBe(true);
    expect(maskId(null)).toBe("—");
  });
});

describe("contrato de consulta", () => {
  it("normaliza ordenação inválida", () => {
    expect(normalizeSort("ordenacao_invalida")).toBeTruthy();
    expect(normalizeSort(null)).toBeTruthy();
  });

  it("período 'all' não gera recorte temporal", () => {
    expect(periodToFromIso("all")).toBeNull();
    expect(typeof periodToFromIso("30d")).toBe("string");
  });

  it("rejeita paginação fora do intervalo permitido", () => {
    expect(() => PerformanceQuerySchema.parse({ pageSize: 5000 })).toThrow();
    expect(() => PerformanceQuerySchema.parse({ page: 0 })).toThrow();
    expect(PerformanceQuerySchema.parse({ pageSize: DEFAULT_PAGE_SIZE }).pageSize).toBe(
      DEFAULT_PAGE_SIZE,
    );
  });

  it("rejeita estratégia desconhecida", () => {
    expect(() => PerformanceQuerySchema.parse({ strategy: "qualquer" })).toThrow();
  });

  it("não aceita company_id vindo do cliente", () => {
    const parsed = PerformanceQuerySchema.parse({
      // @ts-expect-error — campo proibido, deve ser descartado pelo schema
      company_id: "00000000-0000-0000-0000-000000000000",
    });
    expect((parsed as Record<string, unknown>).company_id).toBeUndefined();
  });
});
