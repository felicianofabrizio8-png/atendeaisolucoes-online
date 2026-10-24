import { describe, expect, it, vi } from "vitest";
import { isSalesAgentShadowEnabled, isSalesAgentShadowEnabledForCompany, runSalesAgentShadow } from "@/lib/sales-agent-shadow.server";
import type { AgentDecision, SalesAgentCompletionRequest } from "@/lib/sales-agent-core";

const request = (index: number): SalesAgentCompletionRequest => ({
  model: "gpt-6-luna",
  messages: [
    { role: "system", content: "Dados fictícios autorizados." },
    { role: "user", content: `scenario-${index}: histórico, objeção, catálogo, preço, mídia, follow-up e handoff fictícios.` },
  ],
  tools: [{ type: "function", function: { name: "respond_to_customer", parameters: { type: "object" } } }],
  tool_choice: "auto",
});

describe("shadow mode do fluxo principal da Bruna", () => {
  it("fica desligado por padrão", () => {
    expect(isSalesAgentShadowEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isSalesAgentShadowEnabled({ SALES_AGENT_OPENAI_SHADOW: "enabled" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("exige allowlist de uma empresa além da flag global", () => {
    const env = {
      SALES_AGENT_OPENAI_SHADOW: "enabled",
      SALES_AGENT_OPENAI_SHADOW_COMPANY_ID: "company-pilot",
    } as NodeJS.ProcessEnv;
    expect(isSalesAgentShadowEnabledForCompany("company-pilot", env)).toBe(true);
    expect(isSalesAgentShadowEnabledForCompany("company-other", env)).toBe(false);
    expect(isSalesAgentShadowEnabledForCompany("company-pilot", { SALES_AGENT_OPENAI_SHADOW: "enabled" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("compara 100 cenários sem executar ferramentas, mídia, memória ou envio", async () => {
    const calls: string[] = [];
    const gateway = {
      runChatCompatibility: vi.fn(async (input: { messages: Array<{ content: string }> }) => {
        const index = Number(input.messages[1].content.match(/scenario-(\d+)/)?.[1] ?? 0);
        calls.push(`scenario-${index}`);
        const kindMismatch = index % 17 === 0;
        const safetyCase = index % 19 === 0;
        const handoff = index % 13 === 0 || kindMismatch;
        return {
          id: `resp-${index}`,
          object: "chat.completion" as const,
          model: "gpt-6-luna",
          choices: [{
            index: 0,
            message: {
              role: "assistant" as const,
              content: null,
              tool_calls: [{
                id: `call-${index}`,
                type: "function" as const,
                function: {
                  name: handoff ? "request_human_handoff" : "respond_to_customer",
                  arguments: JSON.stringify({
                    message: safetyCase ? "Garanto as últimas unidades em estoque." : "Posso ajudar com o produto autorizado.",
                    next_action: "qualify",
                  }),
                },
              }],
            },
            finish_reason: "tool_calls" as const,
          }],
          usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
        };
      }),
    };
    const reports = await Promise.all(Array.from({ length: 100 }, async (_, offset) => {
      const index = offset + 1;
      const currentDecision: AgentDecision = index % 13 === 0
        ? { kind: "handoff", reason: "objection" }
        : { kind: "reply", message: "Resposta atual autorizada.", next_action: "qualify", sales_plan: null };
      return runSalesAgentShadow({ companyId: `company-${(index % 10) + 1}`, request: request(index), currentDecision, gateway });
    }));
    expect(reports).toHaveLength(100);
    expect(new Set(reports.map((report) => report.companyId)).size).toBe(10);
    expect(reports.every((report) => report.ok && !report.fallback)).toBe(true);
    expect(reports.filter((report) => !report.kindMatch).length).toBeGreaterThan(0);
    expect(reports.filter((report) => !report.nextActionMatch).length).toBeGreaterThan(0);
    expect(reports.every((report) => report.memoryMatch)).toBe(true);
    expect(reports.filter((report) => report.safetyRisk).length).toBeGreaterThan(0);
    expect(reports.reduce((sum, report) => sum + report.inputTokens, 0)).toBe(12000);
    expect(reports.reduce((sum, report) => sum + report.outputTokens, 0)).toBe(4000);
    expect(reports.every((report) => report.estimatedCostUsd === 0.000032)).toBe(true);
    for (const companyId of Array.from({ length: 10 }, (_, index) => `company-${index + 1}`)) {
      const companyReports = reports.filter((report) => report.companyId === companyId);
      expect(companyReports).toHaveLength(10);
      expect(companyReports.reduce((sum, report) => sum + report.inputTokens, 0)).toBe(1200);
      expect(companyReports.reduce((sum, report) => sum + report.outputTokens, 0)).toBe(400);
    }
    expect(calls).toHaveLength(100);
    expect(gateway.runChatCompatibility).toHaveBeenCalledTimes(100);
  });

  it("trata resposta textual como decisão de resposta, sem fallback silencioso", async () => {
    const gateway = {
      runChatCompatibility: vi.fn().mockResolvedValue({
        id: "resp-text",
        object: "chat.completion" as const,
        model: "gpt-6-luna",
        choices: [{ index: 0, message: { role: "assistant" as const, content: "Posso esclarecer a dúvida com os dados autorizados." }, finish_reason: "stop" as const }],
        usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 },
      }),
    };
    const report = await runSalesAgentShadow({
      companyId: "company-text",
      request: request(101),
      currentDecision: { kind: "reply", message: "Resposta legada.", next_action: null, sales_plan: null },
      gateway,
    });
    expect(report.ok).toBe(true);
    expect(report.fallback).toBe(false);
    expect(report.openAiKind).toBe("reply");
    expect(report.safetyRisk).toBe(false);
  });

  it("compara sales_plan.next_action e não marca ausência de estoque como promessa", async () => {
    const gateway = {
      runChatCompatibility: vi.fn().mockResolvedValue({
        id: "resp-plan",
        object: "chat.completion" as const,
        model: "gpt-6-luna",
        choices: [{ index: 0, message: { role: "assistant" as const, content: null, tool_calls: [{ id: "call-plan", type: "function" as const, function: { name: "respond_to_customer", arguments: JSON.stringify({ message: "Não tenho informação autorizada sobre estoque.", sales_plan: { stage: "qualification", next_action: "discover_needs" } }) } }] }, finish_reason: "tool_calls" as const }],
        usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 },
      }),
    };
    const report = await runSalesAgentShadow({
      companyId: "company-plan",
      request: request(102),
      currentDecision: { kind: "reply", message: "Resposta legada.", next_action: "discover_needs", sales_plan: { stage: "qualification", nextAction: "discover_needs", context: null, adjustments: [] } },
      gateway,
    });
    expect(report.nextActionMatch).toBe(true);
    expect(report.memoryMatch).toBe(true);
    expect(report.safetyRisk).toBe(false);
  });
});
