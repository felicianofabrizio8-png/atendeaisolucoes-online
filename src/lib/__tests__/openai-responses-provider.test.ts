import { describe, expect, it, vi } from "vitest";
import { OpenAiResponsesProvider } from "../llm-gateway/providers/OpenAiResponsesProvider";

describe("OpenAiResponsesProvider", () => {
  it("preserva o contrato legado e força store=false", async () => {
    const run = vi.fn().mockResolvedValue({
      id: "resp_1", model: "gpt-6-luna", outputText: '{"ok":true}', toolCalls: [],
      usage: { inputTokens: 4, outputTokens: 5, cachedInputTokens: 0, reasoningTokens: 0 },
      latencyMs: 12, attempts: 1, estimatedCostUsd: 0.001,
    });
    const provider = new OpenAiResponsesProvider({ gateway: { run } as never, capability: "followup" });
    await expect(provider.execute({
      companyId: "company-a", model: "gpt-6-luna", responseFormat: "json", maxTokens: 32,
      messages: [{ role: "system", content: "Responda JSON" }, { role: "user", content: "Oi" }],
    })).resolves.toMatchObject({ provider: "openai", model: "gpt-6-luna", text: '{"ok":true}', tokensIn: 4, tokensOut: 5 });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "company-a", capability: "followup", store: false,
      responseFormat: "json", maxOutputTokens: 32, instructions: "Responda JSON",
    }));
  });
});
