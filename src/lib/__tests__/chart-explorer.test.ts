// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KpiHero } from "@/components/dashboard/KpiHero";
vi.mock("@/auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "a" }, profile: { company_id: "company-a" } }),
}));
vi.mock("@/components/ui/orb-bloop", () => ({
  OrbBloop: () => React.createElement("span", null, "Orbe Lume"),
}));
import {
  ChartExplorer,
  DashboardAnalysisContext,
} from "@/components/dashboard/charts/ChartExplorer";
const context = {
  title: "Receita",
  period: "Últimos 7 dias",
  notes: "Canal: Instagram",
  columns: ["Dia", "Receita"],
  rows: [["Segunda", "R$ 100"]],
};
beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
afterEach(cleanup);
describe("gráfico expandido", () => {
  it("abre detalhes, conversa sobre o contexto e fecha pelo Escape", async () => {
    const user = userEvent.setup();
    render(
      React.createElement(
        DashboardAnalysisContext.Provider,
        { value: { charts: { Receita: context }, simulated: true } },
        React.createElement(ChartExplorer, {
          title: "Receita",
          children: React.createElement("p", null, "Curva de receita"),
        }),
      ),
    );
    const eye = screen.getByRole("button", { name: "Expandir Receita" });
    await user.click(eye);
    const dialog = screen.getByRole("dialog", { name: "Receita" });
    expect(within(dialog).getByText("R$ 100")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Analisar com Lume" }));
    expect(screen.getByLabelText("Pergunte à Lume sobre este gráfico")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Anexar imagem" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resumo" }));
    expect(await screen.findByText(/Demonstração local/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Ocultar Lume" }));
    expect(dialog.querySelector("#chart-lume-chat")).toHaveAttribute("inert");
    expect(screen.queryByRole("region", { name: "Análise com Lume" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Analisar com Lume" }));
    expect(screen.getByText(/Demonstração local/)).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(eye).toHaveFocus();
  });
  it("preserva o desenho completo da conversão ao ampliar o indicador", async () => {
    const user = userEvent.setup();
    const { container } = render(
      React.createElement(KpiHero, {
        receita: { atual: 100, anterior: 50, variacao: 100 },
        vendas: { atual: 5, anterior: 2, variacao: 150 },
        pipeline: 500,
        pipelineQuentes: 200,
        taxaConversao: 25,
        ticketMedio: 20,
        periodoLabel: "Semana",
      }),
    );
    const original = container.querySelector(".dash-kpi-conversion .dash-conversion-ticks");
    await user.click(screen.getByRole("button", { name: "Expandir Conversão" }));
    const expanded = screen.getByRole("region", { name: "Gráfico ampliado: Conversão" });
    expect(expanded).toHaveClass("dash-kpi-conversion");
    expect(expanded.querySelector(".dash-conversion-ticks")?.innerHTML).toBe(original?.innerHTML);
    expect(expanded.querySelectorAll(".dash-conversion-ticks i")).toHaveLength(40);
    expect(within(expanded).getByText("Vendas ÷ novos leads no período")).toBeVisible();
  });
});
