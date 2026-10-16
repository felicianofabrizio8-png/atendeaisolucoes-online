// src/components/goals/__tests__/goal-form.test.tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoalFormModal } from "../GoalFormModal";

afterEach(cleanup);
const members = [
  { id: "u1", name: "Ana" },
  { id: "u2", name: "Bruno" },
];

describe("formulário de meta", () => {
  it("não avança sem nome e alvo", async () => {
    render(
      <GoalFormModal
        stages={[]}
        members={members}
        agendaReady
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Dê um nome para a meta.");
  });

  it("cria uma meta automática de grupo em 3 passos e mostra o ritmo semanal", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <GoalFormModal
        stages={[]}
        members={members}
        agendaReady
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.type(screen.getByLabelText("Nome da meta"), "Receita de outubro");
    await userEvent.click(screen.getByRole("radio", { name: "Receita fechada" }));
    await userEvent.type(screen.getByLabelText("Alvo"), "100000");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await userEvent.click(screen.getByRole("radio", { name: "Grupo" }));
    await userEvent.click(screen.getByRole("button", { name: "Ana" }));
    await userEvent.click(screen.getByRole("button", { name: "Bruno" }));
    await userEvent.clear(screen.getByLabelText("Início"));
    await userEvent.type(screen.getByLabelText("Início"), "2026-10-01");
    await userEvent.clear(screen.getByLabelText("Fim"));
    await userEvent.type(screen.getByLabelText("Fim"), "2026-10-31");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByText(/por semana/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Criar meta" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Receita de outubro",
        metric: "receita_fechada",
        target: 100000,
        scope: "grupo",
        memberIds: ["u1", "u2"],
      }),
    );
  });

  it("sem a agenda publicada, o indicador de compromissos não aparece", () => {
    render(
      <GoalFormModal
        stages={[]}
        members={members}
        agendaReady={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByRole("radio", { name: "Compromissos concluídos" })).toBeNull();
  });

  it("meta manual pede a unidade", async () => {
    render(
      <GoalFormModal
        stages={[]}
        members={members}
        agendaReady
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText("Nome da meta"), "Posts");
    await userEvent.click(screen.getByRole("radio", { name: "Atualizar à mão" }));
    await userEvent.type(screen.getByLabelText("Alvo"), "8");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Diga a unidade (ex.: visitas).");
  });
});
