// src/lib/goals/__tests__/api.test.ts
import { describe, expect, it } from "vitest";
import { draftToRow, mapGoalRow, mapProgressRow } from "../api";

describe("conversão de linhas", () => {
  it("lê uma meta do banco", () => {
    const goal = mapGoalRow(
      {
        id: "g1",
        company_id: "c1",
        name: "Vendas",
        description: null,
        hue: 275,
        measure: "automatica",
        metric: "vendas_fechadas",
        target: "30",
        unit: null,
        lower_is_better: false,
        scope: "grupo",
        starts_on: "2026-10-01",
        ends_on: "2026-10-31",
        recurrence: null,
        stage_id: "s1",
        archived_at: null,
      },
      ["u1", "u2"],
    );
    expect(goal).toMatchObject({
      target: 30,
      memberIds: ["u1", "u2"],
      stageId: "s1",
      lowerIsBetter: false,
    });
  });
  it("lê o progresso (numeric vem como texto)", () => {
    const raw = mapProgressRow({
      goal_id: "g1",
      period_id: "p1",
      period_start: "2026-10-01",
      period_end: "2026-10-31",
      value: "1500.50",
      weeks: [{ startsOn: "2026-10-01", endsOn: "2026-10-04", actual: "10" }],
      contributions: [{ userId: "u1", value: "1500.5" }],
    });
    expect(raw.value).toBe(1500.5);
    expect(raw.weeks[0].actual).toBe(10);
    expect(raw.contributions[0].value).toBe(1500.5);
  });
  it("monta a linha para salvar a partir do rascunho", () => {
    const row = draftToRow(
      {
        name: " Posts ",
        description: "",
        hue: 300,
        measure: "manual",
        metric: "receita_fechada",
        target: 8,
        unit: "posts",
        scope: "pessoa",
        memberIds: ["u1"],
        deadline: "recorrente",
        startsOn: "2026-10-01",
        endsOn: "2026-10-31",
        recurrence: "semanal",
        stageId: null,
      },
      "c1",
    );
    expect(row).toEqual({
      company_id: "c1",
      name: "Posts",
      description: null,
      hue: 300,
      measure: "manual",
      metric: null,
      target: 8,
      unit: "posts",
      lower_is_better: false,
      scope: "pessoa",
      starts_on: "2026-10-01",
      ends_on: null,
      recurrence: "semanal",
      stage_id: null,
    });
  });
});
