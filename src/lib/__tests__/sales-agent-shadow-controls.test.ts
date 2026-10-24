import { describe, expect, it, vi } from "vitest";
import type { AgentDecision, SalesAgentCompletionRequest } from "../sales-agent-core";
import { resolveShadowControlConfig, runSalesAgentShadowWithControls, shadowIdempotencyKey } from "../sales-agent-shadow-controls.server";
import type { SalesAgentShadowReport } from "../sales-agent-shadow.server";

const request = { model: "gpt-6-luna", messages: [{ role: "system", content: "fixture" }, { role: "user", content: "fixture" }], tools: [], tool_choice: "auto" } as SalesAgentCompletionRequest;
const decision = { kind: "reply", message: "fixture" } as AgentDecision;
const report = (overrides: Partial<SalesAgentShadowReport> = {}): SalesAgentShadowReport => ({ companyId: "company-a", ok: true, latencyMs: 100, inputTokens: 10, outputTokens: 10, estimatedCostUsd: 0.00001, openAiKind: "reply", currentKind: "reply", openAiNextAction: null, currentNextAction: null, kindMatch: true, nextActionMatch: true, memoryMatch: true, safetyRisk: false, fallback: false, ...overrides });
const env = { SALES_AGENT_OPENAI_SHADOW_GUARD: "enabled", SALES_AGENT_OPENAI_SHADOW_BUDGET_USD_MICRO: "100", SALES_AGENT_OPENAI_SHADOW_RESERVATION_USD_MICRO: "20", SALES_AGENT_OPENAI_SHADOW_CALLS_PER_HOUR: "2", SALES_AGENT_OPENAI_SHADOW_CALLS_PER_DAY: "3" } as NodeJS.ProcessEnv;

function dependencies() {
  const budget = { reserve: vi.fn().mockResolvedValue({ reservationId: "r1", duplicate: false }), reconcile: vi.fn().mockResolvedValue(undefined) };
  const rate = { increment: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1) };
  return { budget, rate };
}

describe("controles obrigatórios do shadow OpenAI", () => {
  it("fica desligado e incompleto por padrão", () => {
    expect(resolveShadowControlConfig({} as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(resolveShadowControlConfig({ SALES_AGENT_OPENAI_SHADOW_GUARD: "enabled" } as NodeJS.ProcessEnv).enabled).toBe(false);
  });

  it("reserva antes da chamada e reconcilia o custo depois", async () => {
    const deps = dependencies();
    const execute = vi.fn().mockResolvedValue(report());
    const result = await runSalesAgentShadowWithControls({ companyId: "company-a", request, currentDecision: decision, execute, env, budgetStore: deps.budget, rateLimits: deps.rate });
    expect(result.executed).toBe(true);
    expect(deps.budget.reserve).toHaveBeenCalledBefore(execute);
    expect(deps.budget.reconcile).toHaveBeenCalledWith({ companyId: "company-a", reservationId: "r1", actualMicroUsd: 10, commit: true });
  });

  it("impede duplicidade sem nova chamada nem novo rate limit", async () => {
    const deps = dependencies();
    deps.budget.reserve.mockResolvedValue({ reservationId: "r1", duplicate: true });
    const execute = vi.fn();
    const result = await runSalesAgentShadowWithControls({ companyId: "company-a", request, currentDecision: decision, execute, env, budgetStore: deps.budget, rateLimits: deps.rate });
    expect(result.reason).toBe("shadow_duplicate");
    expect(execute).not.toHaveBeenCalled();
    expect(deps.rate.increment).not.toHaveBeenCalled();
  });

  it("mantém uma única chamada quando duas execuções concorrentes compartilham a mesma reserva", async () => {
    let claimed = false;
    const budget = {
      reserve: vi.fn(async () => {
        if (claimed) return { reservationId: "r1", duplicate: true };
        claimed = true;
        await Promise.resolve();
        return { reservationId: "r1", duplicate: false };
      }),
      reconcile: vi.fn().mockResolvedValue(undefined),
    };
    const rate = { increment: vi.fn().mockResolvedValue(1) };
    const execute = vi.fn().mockResolvedValue(report());
    const results = await Promise.all([
      runSalesAgentShadowWithControls({ companyId: "company-a", request, currentDecision: decision, execute, env, budgetStore: budget, rateLimits: rate }),
      runSalesAgentShadowWithControls({ companyId: "company-a", request, currentDecision: decision, execute, env, budgetStore: budget, rateLimits: rate }),
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.executed)).toHaveLength(1);
    expect(results.filter((result) => result.reason === "shadow_duplicate")).toHaveLength(1);
  });

  it("bloqueia por orçamento, limite e indisponibilidade", async () => {
    const budgetExhausted = dependencies();
    budgetExhausted.budget.reserve.mockRejectedValue(new Error("budget_exhausted"));
    await expect(runSalesAgentShadowWithControls({ companyId: "company-a", request, currentDecision: decision, execute: vi.fn(), env, budgetStore: budgetExhausted.budget, rateLimits: budgetExhausted.rate })).resolves.toMatchObject({ executed: false, reason: "budget_exhausted" });
    const limited = dependencies();
    limited.rate.increment.mockReset().mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    const execute = vi.fn();
    await expect(runSalesAgentShadowWithControls({ companyId: "company-a", request, currentDecision: decision, execute, env, budgetStore: limited.budget, rateLimits: limited.rate })).resolves.toMatchObject({ executed: false, reason: "shadow_call_limit_exceeded" });
    expect(execute).not.toHaveBeenCalled();
    expect(limited.budget.reconcile).toHaveBeenCalledWith({ companyId: "company-a", reservationId: "r1", actualMicroUsd: 0, commit: false });
  });

  it("isola fingerprint por empresa e rollback é instantâneo por configuração", () => {
    expect(shadowIdempotencyKey("company-a", request, decision)).not.toBe(shadowIdempotencyKey("company-b", request, decision));
    expect(resolveShadowControlConfig({ ...env, SALES_AGENT_OPENAI_SHADOW_GUARD: "disabled" }).enabled).toBe(false);
  });
});
