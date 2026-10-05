import { describe, expect, it } from "vitest";

import { AGENT_TICK_BUDGET_MS } from "../ai-agent.server";
import {
  EXTERNAL_SALES_AGENT_MAX_MS,
  EXTERNAL_SALES_AGENT_MIN_MS,
  INTERNAL_LLM_MIN_MS,
  INTERNAL_LLM_TIMEOUT_MS,
  TURN_FALLBACK_RESERVE_MS,
  TURN_SAFETY_MARGIN_MS,
  TURN_SEND_RESERVE_MS,
  externalSalesAgentBudgetMs,
  internalLlmTimeoutMs,
} from "../agent-turn-budget";

const START = 1_000_000;
const DEADLINE = START + AGENT_TICK_BUDGET_MS;
const PLANNED_END = AGENT_TICK_BUDGET_MS - TURN_SAFETY_MARGIN_MS;

describe("orçamento do turno descendo do tick", () => {
  it("valores aprovados: margem 1 s, pós-decisão 3,5 s, fallback 5 s, teto 30 s", () => {
    expect([TURN_SAFETY_MARGIN_MS, TURN_SEND_RESERVE_MS, TURN_FALLBACK_RESERVE_MS, EXTERNAL_SALES_AGENT_MAX_MS, EXTERNAL_SALES_AGENT_MIN_MS, INTERNAL_LLM_MIN_MS, PLANNED_END])
      .toEqual([1_000, 3_500, 5_000, 30_000, 6_000, 3_000, 39_000]);
  });

  it("dá 30 s à Vendedora quando o tick começa", () => {
    expect(externalSalesAgentBudgetMs(DEADLINE, START)).toBe(EXTERNAL_SALES_AGENT_MAX_MS);
  });

  it("com 2 s de preparação a Vendedora recebe 13,5 s", () => {
    expect(externalSalesAgentBudgetMs(DEADLINE, START + 2_000)).toBe(28_500);
  });

  it("encolhe a Vendedora para caber margem, fallback e pós-decisão no que resta", () => {
    expect(externalSalesAgentBudgetMs(DEADLINE, START + 12_000)).toBe(18_500);
    expect(externalSalesAgentBudgetMs(DEADLINE, START + 12_000)).toBeGreaterThan(EXTERNAL_SALES_AGENT_MIN_MS);
    expect(externalSalesAgentBudgetMs(DEADLINE, START + 30_000)).toBe(500);
  });

  it("o fallback interno usa só o que resta, menos margem e pós-decisão", () => {
    // 2 s de preparação + 13,5 s de Vendedora: sobram 24 − 15,5 = 8,5 s; 3,5 s ficam para o pós-decisão.
    expect(internalLlmTimeoutMs(DEADLINE, START + 32_500)).toBe(INTERNAL_LLM_MIN_MS);
    expect(internalLlmTimeoutMs(DEADLINE, START)).toBe(INTERNAL_LLM_TIMEOUT_MS);
  });

  it("sem tempo útil o fallback LLM não é chamado", () => {
    // 24 − 17,5 − 3,5 = 3 s: o mínimo; um ms depois, não chama.
    expect(internalLlmTimeoutMs(DEADLINE, START + 34_500)).toBeNull();
    expect(internalLlmTimeoutMs(DEADLINE, START + 34_501)).toBeNull();
  });

  it("o pior caso (preparação + Vendedora + fallback inteiros + pós-decisão) termina até 39 s", () => {
    for (const prep of [0, 1_000, 2_000, 5_000, 10_000, 15_000]) {
      const external = externalSalesAgentBudgetMs(DEADLINE, START + prep) ?? 0;
      const afterExternal = START + prep + external;
      const fallback = internalLlmTimeoutMs(DEADLINE, afterExternal) ?? 0;
      expect(prep + external + fallback + TURN_SEND_RESERVE_MS).toBeLessThanOrEqual(PLANNED_END);
    }
  });

  it("fora do tick (sem prazo) mantém a config e o teto histórico", () => {
    expect(externalSalesAgentBudgetMs(undefined)).toBeUndefined();
    expect(internalLlmTimeoutMs(undefined)).toBe(INTERNAL_LLM_TIMEOUT_MS);
  });
});
