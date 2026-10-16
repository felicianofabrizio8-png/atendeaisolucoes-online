// src/components/goals/__tests__/goals-lume-card.test.tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoalsLumeCard } from "../GoalsLumeCard";
import type { GoalInsight } from "@/lib/goals/api";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
}));
afterEach(cleanup);
const i = (
  id: string,
  kind: GoalInsight["kind"],
  body: string,
  extra: Partial<GoalInsight> = {},
): GoalInsight => ({
  id,
  kind,
  goalId: "g1",
  body,
  action: null,
  state: "pendente",
  generatedOn: "2026-10-16",
  ...extra,
});
const goals = [{ id: "g1", name: "Orçamentos" }] as never;

describe("cartão da Lume nas metas", () => {
  it("gestor vê resumo, atenção e aplica sugestão com ação", async () => {
    const onApply = vi.fn();
    render(
      <GoalsLumeCard
        canManage
        goals={goals}
        tips={[]}
        onApply={onApply}
        onDismiss={vi.fn()}
        insights={[
          i("r", "resumo", "Orçamentos pedem atenção.", { goalId: null }),
          i("a", "atencao", "12 de 20 esperados."),
          i("s", "sugestao", "Reduzir para 32.", {
            action: { type: "ajustar_alvo", goalId: "g1", target: 32 },
          }),
          i("f", "sugestao", "Foco em follow-up."),
        ]}
      />,
    );
    expect(screen.getByText("Orçamentos pedem atenção.")).toBeInTheDocument();
    expect(screen.getByText(/12 de 20 esperados/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Aplicar: Reduzir para 32." }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ id: "s" }));
    expect(screen.queryByRole("button", { name: "Aplicar: Foco em follow-up." })).toBeNull();
  });
  it("usuário vê só a dica dele, sem aplicar", () => {
    render(
      <GoalsLumeCard
        canManage={false}
        goals={goals}
        insights={[]}
        tips={[i("d", "dica", "Faltam 4 orçamentos.", { goalId: null })]}
        onApply={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("Faltam 4 orçamentos.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Aplicar/ })).toBeNull();
  });
  it("pergunta à Lume e mostra a resposta", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ answer: "Porque 3 orçamentos ficaram em rascunho." })),
      );
    render(
      <GoalsLumeCard
        canManage
        goals={goals}
        insights={[]}
        tips={[]}
        onApply={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Pergunte à Lume sobre as metas" }),
      "Por que atrasou?{Enter}",
    );
    expect(await screen.findByText("Porque 3 orçamentos ficaram em rascunho.")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/goals/ask");
    fetchMock.mockRestore();
  });
});
