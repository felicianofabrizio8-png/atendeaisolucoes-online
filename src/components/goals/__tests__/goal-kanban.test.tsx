// src/components/goals/__tests__/goal-kanban.test.tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoalKanban } from "../GoalKanban";
import type { Goal, GoalProgress } from "@/lib/goals/model";

afterEach(cleanup);
const goal = (id: string, stageId: string | null): Goal => ({
  id,
  companyId: "c",
  name: `Meta ${id}`,
  description: null,
  hue: 275,
  measure: "automatica",
  metric: "vendas_fechadas",
  target: 10,
  unit: null,
  lowerIsBetter: false,
  scope: "empresa",
  startsOn: "2026-10-01",
  endsOn: "2026-10-31",
  recurrence: null,
  stageId,
  archivedAt: null,
  memberIds: [],
});
const progress = new Map<string, GoalProgress>([
  [
    "a",
    {
      goalId: "a",
      periodId: "p",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      value: 3,
      weeks: [],
      contributions: [],
      expected: 5,
      status: "atrasada",
      pct: 30,
    },
  ],
]);
const stages = [
  { id: "s1", name: "Planejada", hue: 275, position: 0 },
  { id: "s2", name: "Em execução", hue: 200, position: 1 },
];
const base = {
  progress,
  stages,
  members: [],
  onOpen: vi.fn(),
  onSaveStage: vi.fn(),
  onRemoveStage: vi.fn(),
};

describe("kanban de metas", () => {
  it("mostra colunas do admin e o selo automático", () => {
    render(
      <GoalKanban
        {...base}
        goals={[goal("a", "s1"), goal("b", null)]}
        canManage
        onMove={vi.fn()}
      />,
    );
    const planned = screen.getByRole("region", { name: "Planejada" });
    expect(within(planned).getByText("Meta a")).toBeInTheDocument();
    expect(within(planned).getByText("Atrasada")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sem etapa" })).toHaveTextContent("Meta b");
  });
  it("arrastar para outra coluna move a meta", () => {
    const onMove = vi.fn();
    render(<GoalKanban {...base} goals={[goal("a", "s1")]} canManage onMove={onMove} />);
    const card = screen.getByText("Meta a").closest("[draggable]")!;
    const target = screen.getByRole("region", { name: "Em execução" });
    fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
    fireEvent.dragOver(target, { dataTransfer: {} });
    fireEvent.drop(target, { dataTransfer: { getData: () => "a" } });
    expect(onMove).toHaveBeenCalledWith("a", "s2");
  });
  it("'Mover para…' move pelo menu (celular e teclado)", async () => {
    const onMove = vi.fn();
    render(<GoalKanban {...base} goals={[goal("a", "s1")]} canManage onMove={onMove} />);
    await userEvent.click(screen.getByRole("button", { name: "Mover Meta a" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Em execução" }));
    expect(onMove).toHaveBeenCalledWith("a", "s2");
  });
  it("sem permissão de gestão não arrasta nem mostra mover", () => {
    render(<GoalKanban {...base} goals={[goal("a", "s1")]} canManage={false} onMove={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Mover Meta a" })).toBeNull();
    expect(screen.getByText("Meta a").closest("[draggable]")).toHaveAttribute("draggable", "false");
  });
  it("sem etapas convida a criar", () => {
    render(
      <GoalKanban {...base} stages={[]} goals={[goal("a", null)]} canManage onMove={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Criar etapas" })).toBeInTheDocument();
  });
});
