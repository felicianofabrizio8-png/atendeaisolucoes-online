// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GradientHeatmap } from "@/components/dashboard/charts/GradientHeatmap";

afterEach(cleanup);

function renderPeriod(days: number) {
  const hours = Array.from({ length: 15 }, (_, i) => i + 7);
  const values = hours.map((_, hour) => Array.from({ length: days }, (_, day) => hour * 100 + day));
  return render(
    React.createElement(GradientHeatmap, {
      valores: values,
      linhas: hours,
      colunas: Array.from({ length: days }, (_, i) => String(i + 1)),
      colunasCheias: Array.from({ length: days }, (_, i) => `Dia ${i + 1}`),
    }),
  );
}

describe("Entrada de leads", () => {
  it("exibe a semana na horizontal e preserva a contagem de cada dia e horário", () => {
    const { container } = renderPeriod(7);
    const svg = screen.getByRole("img");
    const [, , width, height] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    expect(width).toBeGreaterThan(height);
    expect(container.querySelectorAll("rect")).toHaveLength(105);
    expect(Array.from(container.querySelectorAll("svg text"), (el) => el.textContent)).toEqual([
      "7h",
      "21h",
    ]);

    // 9h do quarto dia: a transposição não pode trocar o dado por 10h do terceiro.
    const cell = screen.getByText("Dia 4, 9h: 203 leads").parentElement!;
    fireEvent.mouseEnter(cell);
    expect(screen.getByRole("status").textContent).toBe("Dia 4, 9h — 203 leads");
    fireEvent.mouseLeave(cell);
    expect(screen.getByRole("status").textContent).toContain("Dias: 1 a 7");
  });

  it.each([30, 12])("preserva os eixos do período com %i colunas", (days) => {
    const { container } = renderPeriod(days);
    expect(container.querySelectorAll("rect")).toHaveLength(days * 15);
    expect(Array.from(container.querySelectorAll("svg text"), (el) => el.textContent)).toEqual([
      "1",
      String(days),
    ]);
    const cell = screen.getByText("Dia 4, 9h: 203 leads").parentElement!;
    fireEvent.mouseEnter(cell);
    expect(screen.getByRole("status").textContent).toBe("Dia 4, 9h — 203 leads");
  });
});
