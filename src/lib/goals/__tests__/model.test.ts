// src/lib/goals/__tests__/model.test.ts
import { describe, expect, it } from "vitest";
import {
  buildProgress,
  daysBetween,
  expectedToDate,
  formatGoalValue,
  goalStatus,
  splitWeeks,
  todayInSaoPaulo,
  validateGoalDraft,
  type Goal,
  type GoalDraft,
} from "../model";

const oct = { startsOn: "2026-10-01", endsOn: "2026-10-31" };

describe("datas", () => {
  it("conta dias inclusivos", () => {
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(31);
    expect(daysBetween("2026-10-16", "2026-10-16")).toBe(1);
  });
  it("dia de hoje no fuso de São Paulo", () => {
    expect(todayInSaoPaulo(new Date("2026-10-17T02:30:00Z"))).toBe("2026-10-16");
  });
});

describe("esperado até hoje", () => {
  it("é proporcional aos dias decorridos", () => {
    expect(expectedToDate(31000, oct, "2026-10-10", false)).toBe(10000);
  });
  it("antes do início é zero e depois do fim é o alvo", () => {
    expect(expectedToDate(100, oct, "2026-09-30", false)).toBe(0);
    expect(expectedToDate(100, oct, "2026-11-02", false)).toBe(100);
  });
  it("período de um dia que é hoje espera o alvo inteiro", () => {
    expect(
      expectedToDate(8, { startsOn: "2026-10-16", endsOn: "2026-10-16" }, "2026-10-16", false),
    ).toBe(8);
  });
  it("menor é melhor espera o próprio alvo", () => {
    expect(expectedToDate(10, oct, "2026-10-05", true)).toBe(10);
  });
});

describe("selo", () => {
  const base = { target: 100, lowerIsBetter: false, period: oct, today: "2026-10-16" };
  it("concluída ao bater o alvo", () => {
    expect(goalStatus({ ...base, value: 100, expected: 51.6 })).toBe("concluida");
  });
  it("no ritmo, em risco e atrasada pelas faixas", () => {
    expect(goalStatus({ ...base, value: 47, expected: 51.6 })).toBe("no_ritmo");
    expect(goalStatus({ ...base, value: 40, expected: 51.6 })).toBe("em_risco");
    expect(goalStatus({ ...base, value: 30, expected: 51.6 })).toBe("atrasada");
  });
  it("sem dados antes do primeiro terço", () => {
    expect(goalStatus({ ...base, today: "2026-10-05", value: null, expected: 16 })).toBe(
      "sem_dados",
    );
  });
  it("sem dados depois do primeiro terço vira atrasada", () => {
    expect(goalStatus({ ...base, value: null, expected: 51.6 })).toBe("atrasada");
  });
  it("encerrada quando o prazo passou sem bater", () => {
    expect(goalStatus({ ...base, today: "2026-11-01", value: 80, expected: 100 })).toBe(
      "encerrada",
    );
  });
  it("menor é melhor: sem conversa nunca conclui", () => {
    expect(
      goalStatus({
        ...base,
        lowerIsBetter: true,
        target: 10,
        value: null,
        expected: 10,
        today: "2026-11-01",
      }),
    ).toBe("sem_dados");
  });
  it("menor é melhor: abaixo do alvo está no ritmo e no fim conclui", () => {
    const lower = { ...base, lowerIsBetter: true, target: 10, expected: 10 };
    expect(goalStatus({ ...lower, value: 8 })).toBe("no_ritmo");
    expect(goalStatus({ ...lower, value: 12 })).toBe("em_risco");
    expect(goalStatus({ ...lower, value: 20 })).toBe("atrasada");
    expect(goalStatus({ ...lower, value: 8, today: "2026-11-01" })).toBe("concluida");
  });
});

describe("semanas", () => {
  it("divide de segunda a domingo, com pontas parciais proporcionais", () => {
    const weeks = splitWeeks(oct, 31, false);
    expect(weeks[0]).toEqual({ startsOn: "2026-10-01", endsOn: "2026-10-04", expected: 4 });
    expect(weeks[1]).toEqual({ startsOn: "2026-10-05", endsOn: "2026-10-11", expected: 7 });
    expect(weeks.at(-1)).toEqual({ startsOn: "2026-10-26", endsOn: "2026-10-31", expected: 6 });
    expect(weeks.reduce((s, w) => s + w.expected, 0)).toBeCloseTo(31);
  });
});

describe("progresso", () => {
  const goal: Goal = {
    id: "g1",
    companyId: "c1",
    name: "Vendas",
    description: null,
    hue: 275,
    measure: "automatica",
    metric: "vendas_fechadas",
    target: 31,
    unit: null,
    lowerIsBetter: false,
    scope: "empresa",
    startsOn: "2026-10-01",
    endsOn: "2026-10-31",
    recurrence: null,
    stageId: null,
    archivedAt: null,
    memberIds: [],
  };
  it("junta valor, esperado, selo e semanas", () => {
    const p = buildProgress(
      goal,
      {
        goalId: "g1",
        periodId: "p1",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        value: 9,
        weeks: [
          { startsOn: "2026-10-01", endsOn: "2026-10-04", actual: 4 },
          { startsOn: "2026-10-05", endsOn: "2026-10-11", actual: 5 },
        ],
        contributions: [{ userId: "u1", value: 9 }],
      },
      "2026-10-10",
    );
    expect(p.expected).toBe(10);
    expect(p.status).toBe("no_ritmo");
    expect(p.pct).toBeCloseTo(29.03, 1);
    expect(p.weeks[1]).toMatchObject({ expected: 7, actual: 5, status: "em_risco" }); // esperado até 10/10 = 6; 5/6 = 83%
  });
});

describe("rascunho", () => {
  const ok: GoalDraft = {
    name: "Vendas de outubro",
    description: "",
    hue: 275,
    measure: "automatica",
    metric: "receita_fechada",
    target: 100000,
    unit: "",
    scope: "empresa",
    memberIds: [],
    deadline: "unico",
    startsOn: "2026-10-01",
    endsOn: "2026-10-31",
    recurrence: "mensal",
    stageId: null,
  };
  it("aceita um rascunho válido", () => expect(validateGoalDraft(ok)).toEqual([]));
  it("explica cada problema", () => {
    expect(validateGoalDraft({ ...ok, name: " " })).toContain("Dê um nome para a meta.");
    expect(validateGoalDraft({ ...ok, target: 0 })).toContain("O alvo precisa ser maior que zero.");
    expect(validateGoalDraft({ ...ok, metric: null })).toContain(
      "Escolha o que o sistema vai medir.",
    );
    expect(validateGoalDraft({ ...ok, measure: "manual", unit: "" })).toContain(
      "Diga a unidade (ex.: visitas).",
    );
    expect(validateGoalDraft({ ...ok, scope: "pessoa", memberIds: [] })).toContain(
      "Escolha a pessoa da meta.",
    );
    expect(validateGoalDraft({ ...ok, scope: "grupo", memberIds: ["a"] })).toContain(
      "Um grupo precisa de pelo menos 2 pessoas.",
    );
    expect(validateGoalDraft({ ...ok, endsOn: "2026-09-01" })).toContain(
      "A data de fim precisa ser depois do início.",
    );
  });
});

describe("formatação", () => {
  const g = (
    metric: Goal["metric"],
    measure: Goal["measure"] = "automatica",
    unit: string | null = null,
  ) => ({ metric, measure, unit });
  it("formata por tipo de indicador", () => {
    expect(formatGoalValue(62000, g("receita_fechada"))).toBe("R$ 62.000");
    expect(formatGoalValue(12, g("vendas_fechadas"))).toBe("12");
    expect(formatGoalValue(18.5, g("taxa_conversao"))).toBe("18,5%");
    expect(formatGoalValue(7.25, g("tempo_primeira_resposta"))).toBe("7,3 min");
    expect(formatGoalValue(3, g(null, "manual", "visitas"))).toBe("3 visitas");
    expect(formatGoalValue(null, g("vendas_fechadas"))).toBe("—");
  });
});
