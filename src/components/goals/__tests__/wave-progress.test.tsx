// src/components/goals/__tests__/wave-progress.test.tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WaveProgress } from "../WaveProgress";

afterEach(cleanup);

describe("barra de ondas", () => {
  it("é uma barra de progresso acessível com o texto do valor", () => {
    render(<WaveProgress pct={62.4} status="no_ritmo" label="62% · R$ 62 mil de R$ 100 mil" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "62");
    expect(bar).toHaveAttribute("aria-valuetext", "62% · R$ 62 mil de R$ 100 mil");
    expect(bar).toHaveAttribute("data-status", "no_ritmo");
  });
  it("limita entre 0 e 100", () => {
    const { rerender } = render(<WaveProgress pct={140} status="concluida" label="x" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    rerender(<WaveProgress pct={-5} status="atrasada" label="x" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});
