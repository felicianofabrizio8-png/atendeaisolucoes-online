// src/components/goals/__tests__/goals-dashboard.test.tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GoalsDashboardView } from "../GoalsDashboard";
import type { Goal, GoalProgress } from "@/lib/goals/model";

afterEach(cleanup);
const goal = (id: string, scope: Goal["scope"], memberIds: string[] = []): Goal => ({
  id,
  companyId: "c",
  name: `Meta ${id}`,
  description: null,
  hue: 275,
  measure: "automatica",
  metric: "receita_fechada",
  target: 100000,
  unit: null,
  lowerIsBetter: false,
  scope,
  startsOn: "2026-10-01",
  endsOn: "2026-10-31",
  recurrence: null,
  stageId: null,
  archivedAt: null,
  memberIds,
});
const p = (goalId: string, status: GoalProgress["status"], value: number): GoalProgress => ({
  goalId,
  periodId: "p",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  value,
  weeks: [],
  contributions: [{ userId: "u1", value }],
  expected: 50000,
  status,
  pct: value / 1000,
});
const props = {
  goals: [goal("a", "empresa"), goal("b", "pessoa", ["u1"]), goal("c", "empresa")],
  progress: new Map([
    ["a", p("a", "no_ritmo", 62000)],
    ["b", p("b", "em_risco", 40000)],
    ["c", p("c", "atrasada", 10000)],
  ]),
  stages: [],
  insights: [
    {
      id: "i1",
      kind: "resumo" as const,
      goalId: null,
      body: "Duas metas pedem atenção.",
      action: null,
      state: "pendente" as const,
      generatedOn: "2026-10-16",
    },
  ],
  members: [{ id: "u1", name: "Ana" }],
  me: "u1",
  onCreate: vi.fn(),
  onOpen: vi.fn(),
  onMove: vi.fn(),
  onSaveStage: vi.fn(),
  onRemoveStage: vi.fn(),
  onApply: vi.fn(),
  onDismiss: vi.fn(),
  onEntry: vi.fn(),
};

describe("painel de metas", () => {
  it("gestor vê números, destaques, Lume e a área de gestão", () => {
    render(<GoalsDashboardView {...props} canManage />);
    // O mesmo rótulo aparece no selo dos cartões: conferir só o bloco de números.
    const stat = (label: string) =>
      screen
        .getAllByText(label)
        .map((el) => el.closest(".gl-stat"))
        .find(Boolean);
    expect(stat("No ritmo")).toHaveTextContent("1");
    expect(stat("Em risco")).toHaveTextContent("1");
    expect(screen.getByText("Duas metas pedem atenção.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nova meta" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Kanban" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Contribuição" })).toHaveTextContent("Ana");
  });
  it("usuário vê 'Suas metas' sem gestão", () => {
    render(<GoalsDashboardView {...props} canManage={false} />);
    expect(screen.getByRole("heading", { name: "Suas metas" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nova meta" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Kanban" })).toBeNull();
  });
  it("sem metas: gestor é convidado a criar a primeira", () => {
    render(<GoalsDashboardView {...props} goals={[]} progress={new Map()} canManage />);
    expect(screen.getByText("Crie a primeira meta da equipe.")).toBeInTheDocument();
  });
});
