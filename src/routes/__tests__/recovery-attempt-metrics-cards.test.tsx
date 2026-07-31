// ============================================================================
// SPRINT 6 · FASE 6.3.1 — Cards de métricas operacionais (UI).
//
// Contrato visível: os nove indicadores derivados de tentativas reais, o
// seletor de período, e os estados de carregamento, vazio e erro — no layout
// mobile (grid de 2 colunas) e no desktop (grid de 5 colunas).
// ============================================================================
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RecoveryAttemptMetricsCards } from "@/components/recovery/RecoveryAttemptMetricsCards";
import type { RecoveryAttemptMetrics } from "@/lib/recovery-exec/metrics";

const METRICS: RecoveryAttemptMetrics = {
  today: 4,
  sent: 12,
  failed: 2,
  waitingReply: 5,
  replied: 6,
  recovered: 3,
  notRecovered: 1,
  replyRate: 50,
  recoveryRate: 25,
};

afterEach(cleanup);

function setup(props: Partial<React.ComponentProps<typeof RecoveryAttemptMetricsCards>> = {}) {
  const onPeriodChange = vi.fn();
  render(
    <RecoveryAttemptMetricsCards
      metrics={METRICS}
      period="30d"
      onPeriodChange={onPeriodChange}
      {...props}
    />,
  );
  return { onPeriodChange };
}

describe("cards de tentativas", () => {
  it("mostra todos os indicadores operacionais", () => {
    setup();
    const val = (key: string) => screen.getByTestId(`attempt-metric-${key}`).textContent ?? "";
    expect(val("today")).toContain("4");
    expect(val("sent")).toContain("12");
    expect(val("failed")).toContain("2");
    expect(val("waiting")).toContain("5");
    expect(val("replied")).toContain("6");
    expect(val("recovered")).toContain("3");
    expect(val("not_recovered")).toContain("1");
    expect(val("reply_rate")).toContain("50%");
    expect(val("recovery_rate")).toContain("25%");
  });

  it("layout mobile-first com desktop preservado", () => {
    setup();
    const grid = screen.getByTestId("attempt-metric-sent").parentElement!;
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.className).toContain("lg:grid-cols-5");
  });

  it("alvos de toque confortáveis no seletor de período", async () => {
    const { onPeriodChange } = setup();
    const btn = screen.getByRole("button", { name: "7 dias" });
    expect(btn.className).toContain("h-9");
    await userEvent.click(btn);
    expect(onPeriodChange).toHaveBeenCalledWith("7d");
  });

  it("estado de carregamento", () => {
    setup({ loading: true });
    expect(screen.getByTestId("attempt-metric-sent").querySelector(".animate-pulse")).toBeTruthy();
  });

  it("estado vazio amigável", () => {
    setup({ empty: true, metrics: null });
    expect(screen.getByText(/Nenhuma tentativa de recuperação neste período/i)).toBeTruthy();
  });

  it("erro amigável, sem jargão técnico", () => {
    setup({ error: true });
    const msg = screen.getByText(/Não foi possível carregar as métricas/i).textContent ?? "";
    expect(msg.toLowerCase()).not.toMatch(/error|500|fetch/);
  });

  it("não expõe Recovery Score nem chance heurística", () => {
    setup();
    expect(screen.queryByText(/score/i)).toBeNull();
    expect(screen.queryByText(/chance/i)).toBeNull();
  });
});
