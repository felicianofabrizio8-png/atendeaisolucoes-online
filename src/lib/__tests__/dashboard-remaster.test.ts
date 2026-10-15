// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TimelineChart } from "@/components/dashboard/charts/TimelineChart";
import { RevenueTrend, LeadsTrend } from "@/components/dashboard/PerformancePanels";
import type { DashboardMetrics } from "@/components/dashboard/useDashboardMetrics";
import { brl, brlCompact } from "@/components/dashboard/charts/primitives";
import { ChartDetails } from "@/components/dashboard/charts/ChartCard";
import {
  ActivityHeatmap,
  ChannelOrbit,
  LeadComparison,
} from "@/components/dashboard/charts/SignatureCharts";
import userEvent from "@testing-library/user-event";
import { AiLoadChart, buildAiLoad } from "@/components/dashboard/charts/AiLoadChart";
import { activityHeatColor } from "@/components/dashboard/charts/SignatureCharts";
import type { DashboardData } from "@/components/dashboard/useDashboardData";
afterEach(cleanup);
describe("dashboard: leitura e interação dos gráficos", () => {
  it("não conta a mesma conversa em duas fatias da IA e preserva canais sem volume", () => {
    const conversations = [
      { channel: "whatsapp", aiStatus: "aguardando_humano", aiHandling: true },
      { channel: "whatsapp", aiStatus: "pre_atendido_ia", aiHandling: true },
      { channel: "instagram", aiHandling: true },
      { channel: "facebook", aiHandling: false },
    ] as DashboardData["conversations"];
    const result = buildAiLoad(conversations);
    expect(result.total).toBe(3);
    expect(result.totals).toEqual({ active: 1, completed: 1, waiting: 1 });
    const { container } = render(React.createElement(AiLoadChart, { conversations }));
    expect(container.querySelectorAll(".dash-ai-stack")[0].children).toHaveLength(2);
    expect(container.querySelectorAll(".dash-ai-stack")[2].children).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /^WhatsApp:/ }));
    expect(
      screen.getByText(/WhatsApp · 1 concluídas · 0 em atendimento · 1 aguardando humano/),
    ).toBeVisible();
    expect(container.innerHTML).not.toContain("NaN");
  });
  it("mostra o estado vazio da IA e mantém o zero na cor mínima do mapa de calor", () => {
    render(React.createElement(AiLoadChart, { conversations: [] }));
    expect(screen.getByText("Nenhuma conversa da IA para comparar.")).toBeVisible();
    expect(activityHeatColor(0, 0)).toContain("#241048");
    expect(activityHeatColor(10, 10)).toContain("#ffe66b");
    expect(activityHeatColor(4, 10)).not.toEqual(activityHeatColor(5, 10));
  });
  it("carrega os detalhes apenas quando solicitados e libera ao fechar", async () => {
    render(
      React.createElement(ChartDetails, {
        title: "Ver detalhes",
        children: React.createElement("p", null, "Gráfico detalhado"),
      }),
    );
    expect(screen.queryByText("Gráfico detalhado")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Ver detalhes"));
    expect(await screen.findByText("Gráfico detalhado")).toBeVisible();
    await userEvent.click(screen.getByText("Ver detalhes"));
    expect(screen.queryByText("Gráfico detalhado")).not.toBeInTheDocument();
  });
  it("expõe valores exatos ao focar ou tocar um intervalo, mesmo com eixo abreviado", () => {
    render(
      React.createElement(TimelineChart, {
        data: [
          { label: "1", fullLabel: "Primeiro intervalo", value: 12450 },
          { label: "2", fullLabel: "Segundo intervalo", value: 0 },
        ],
        label: "Receita",
        format: brlCompact,
        formatValue: brl,
      }),
    );
    const first = screen.getByRole("button", { name: `Primeiro intervalo: ${brl(12450)}` });
    fireEvent.focus(first);
    expect(screen.getByText(brl(12450).replace(/\s/g, " "), { selector: "strong" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: `Segundo intervalo: ${brl(0)}` }));
    expect(screen.getByText(brl(0).replace(/\s/g, " "), { selector: "strong" })).toBeVisible();
  });
  it("troca o canal da receita sem misturar o total e mostra estado vazio", () => {
    const m = {
      serieReceitaCanal: [
        {
          label: "1",
          fullLabel: "Intervalo",
          total: 12450,
          porCanal: { whatsapp: 10400, instagram: 2050, facebook: 0 },
        },
      ],
    } as unknown as DashboardMetrics;
    render(React.createElement(RevenueTrend, { m, periodoLabel: "últimos 7 dias" }));
    expect(screen.getByText(brl(12450).replace(/\s/g, " "))).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Instagram" }));
    expect(screen.getByText(brl(2050).replace(/\s/g, " "))).toBeVisible();
    expect(screen.queryByText(brl(12450).replace(/\s/g, " "))).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Facebook" }));
    expect(screen.getByText("Nenhuma venda fechada neste canal e período.")).toBeVisible();
  });
  it("mantém a comparação anterior e não desenha leads fictícios quando o período está vazio", () => {
    const m = {
      serieLeads: [{ label: "1", fullLabel: "Dia 1", value: 0 }],
      serieLeadsAnterior: [{ label: "1", fullLabel: "Antes", value: 8 }],
      gradeLeads: { valores: [], colunas: [], colunasCheias: [], linhas: [], total: 0 },
    } as unknown as DashboardMetrics;
    render(React.createElement(LeadsTrend, { m, periodoLabel: "últimos 7 dias" }));
    expect(screen.getByText("8 no período anterior")).toBeVisible();
    expect(screen.getByRole("group", { name: "Comparação de leads por intervalo" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Dia 1: 0 leads; intervalo equivalente anterior: 8" }),
    ).toBeVisible();
  });
  it("usa a mesma unidade nos dois períodos e preserva valores parciais", () => {
    const { container } = render(
      React.createElement(LeadComparison, {
        current: [{ label: "1", fullLabel: "Dia 1", value: 0 }],
        previous: [{ label: "1", fullLabel: "Antes", value: 9 }],
      }),
    );
    expect(screen.getByText("1 bloco = 2 leads")).toBeVisible();
    const blocks = container.querySelectorAll<HTMLElement>(".dash-lead-block");
    expect([...blocks].slice(0, 5).every((b) => b.style.opacity === "0.35")).toBe(true);
    expect(blocks[9].style.background).toContain("50%");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/0 agora \/ 9 antes/)).toBeVisible();
  });
  it("seleciona a participação do canal sem desenhar arcos para valores zero", () => {
    const { container } = render(
      React.createElement(ChannelOrbit, {
        channels: [
          { key: "whatsapp", label: "WhatsApp", leads: 3, vendas: 1, receita: 100 },
          { key: "instagram", label: "Instagram", leads: 1, vendas: 0, receita: 0 },
          { key: "facebook", label: "Facebook", leads: 0, vendas: 0, receita: 0 },
        ],
      }),
    );
    expect(container.querySelectorAll("svg path")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /^Instagram/ }));
    expect(container.querySelector(".dash-orbit-center strong")).toHaveTextContent("25%");
    fireEvent.click(screen.getByRole("button", { name: /^Facebook/ }));
    expect(container.querySelector(".dash-orbit-center strong")).toHaveTextContent("0%");
    expect(container.innerHTML).not.toContain("NaN");
  });
  it("navega o mapa de horários pelas setas com uma única entrada de tabulação", () => {
    render(
      React.createElement(ActivityHeatmap, {
        hours: [7, 8],
        data: [{ day: 1, hour: 7, value: 5 }],
      }),
    );
    const peak = screen.getByRole("button", { name: "Seg, 7h: 5 registros" });
    expect(peak).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(peak, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "Seg, 8h: 0 registros" })).toHaveFocus();
    expect(screen.getAllByRole("button").filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(screen.getByText("0 registros", { selector: "strong" })).toBeVisible();
  });
  it("não cria barras preenchidas para contagem zero", () => {
    const { container } = render(
      React.createElement(TimelineChart, {
        data: [
          { label: "1", fullLabel: "Dia 1", value: 0 },
          { label: "2", fullLabel: "Dia 2", value: 3 },
        ],
        kind: "bars",
        label: "Leads",
      }),
    );
    const filled = container.querySelectorAll('rect[fill^="url"]');
    expect(filled).toHaveLength(1);
    expect(Number(filled[0].getAttribute("height"))).toBeGreaterThan(0);
    expect(container.innerHTML).not.toContain("NaN");
  });
});
