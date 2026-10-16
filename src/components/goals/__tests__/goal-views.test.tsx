// src/components/goals/__tests__/goal-views.test.tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoalWeekView } from "../GoalWeekView";
import { GoalListView } from "../GoalListView";
import type { Goal, GoalProgress } from "@/lib/goals/model";

afterEach(cleanup);
const g = (id: string, name: string, memberIds: string[] = []): Goal => ({
  id,
  companyId: "c",
  name,
  description: null,
  hue: 275,
  measure: "automatica",
  metric: "vendas_fechadas",
  target: 14,
  unit: null,
  lowerIsBetter: false,
  scope: memberIds.length ? "pessoa" : "empresa",
  startsOn: "2026-10-05",
  endsOn: "2026-10-18",
  recurrence: null,
  stageId: null,
  archivedAt: null,
  memberIds,
});
const p = (goalId: string, status: GoalProgress["status"]): GoalProgress => ({
  goalId,
  periodId: "p",
  periodStart: "2026-10-05",
  periodEnd: "2026-10-18",
  value: 5,
  contributions: [],
  expected: 8,
  status,
  pct: 35,
  weeks: [
    { startsOn: "2026-10-05", endsOn: "2026-10-11", expected: 7, actual: 5, status: "em_risco" },
    { startsOn: "2026-10-12", endsOn: "2026-10-18", expected: 7, actual: null, status: null },
  ],
});
const goals = [g("a", "Vendas da loja"), g("b", "Orçamentos da Ana", ["u1"])];
const progress = new Map([
  ["a", p("a", "em_risco")],
  ["b", p("b", "no_ritmo")],
]);

describe("visão semanal", () => {
  it("mostra feito × esperado por semana e semanas futuras vazias", () => {
    render(<GoalWeekView goals={goals} progress={progress} onOpen={vi.fn()} />);
    expect(screen.getAllByText("5 / 7").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("lista", () => {
  it("busca pelo nome e filtra pelo selo", async () => {
    render(
      <GoalListView
        goals={goals}
        progress={progress}
        members={[{ id: "u1", name: "Ana" }]}
        onOpen={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar metas" }), "ana");
    expect(screen.queryByText("Vendas da loja")).toBeNull();
    expect(screen.getByText("Orçamentos da Ana")).toBeInTheDocument();
    await userEvent.clear(screen.getByRole("searchbox", { name: "Buscar metas" }));
    await userEvent.click(screen.getByRole("button", { name: "Em risco" }));
    expect(screen.getByText("Vendas da loja")).toBeInTheDocument();
    expect(screen.queryByText("Orçamentos da Ana")).toBeNull();
  });
});
