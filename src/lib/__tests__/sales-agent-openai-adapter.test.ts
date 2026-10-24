import { describe, expect, it, vi } from "vitest";
import { isSalesAgentOpenAiResponsesEnabled } from "@/lib/sales-agent-openai-feature-flag";
import { completeSalesAgentWithOpenAi } from "@/lib/sales-agent-openai-adapter.server";
import type { SalesAgentCompletionRequest } from "@/lib/sales-agent-core";

const request: SalesAgentCompletionRequest = {
  model: "gpt-6-luna",
  messages: [
    { role: "system", content: "Catálogo autorizado da empresa" },
    { role: "user", content: "Cliente fictício pergunta sobre o produto autorizado." },
  ],
  tools: [{
    type: "function",
    function: { name: "respond_to_customer", parameters: { type: "object", properties: { message: { type: "string" } } } },
  }],
  tool_choice: "auto",
};

describe("adaptador OpenAI do fluxo principal da Bruna", () => {
  it("permanece desligado por padrão e exige opt-in explícito", () => {
    expect(isSalesAgentOpenAiResponsesEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isSalesAgentOpenAiResponsesEnabled({ SALES_AGENT_OPENAI_RESPONSES: "enabled" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("preserva contrato de tool call, tenant e histórico sem enviar nada", async () => {
    const response = {
      id: "resp_sales_test",
      object: "chat.completion" as const,
      model: "gpt-6-luna",
      choices: [{ index: 0, message: { role: "assistant" as const, content: null, tool_calls: [{ id: "call-1", type: "function" as const, function: { name: "respond_to_customer", arguments: JSON.stringify({ message: "Vou verificar o produto autorizado." }) } }] }, finish_reason: "tool_calls" as const }],
      usage: { prompt_tokens: 12, completion_tokens: 9, total_tokens: 21 },
    };
    const runChatCompatibility = vi.fn().mockResolvedValue(response);
    const result = await completeSalesAgentWithOpenAi({ companyId: "company-a", request, gateway: { runChatCompatibility } });
    expect(result).toEqual({ ok: true, data: response });
    expect(runChatCompatibility).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "company-a",
      capability: "sales_agent",
      model: "gpt-6-luna",
      messages: request.messages,
      toolChoice: "auto",
    }));
    expect(runChatCompatibility.mock.calls[0][0].tools[0].function.name).toBe("respond_to_customer");
  });

  it("devolve falha técnica para o fallback legado, sem decisão automática", async () => {
    const runChatCompatibility = vi.fn().mockRejectedValue(new Error("provider down"));
    await expect(completeSalesAgentWithOpenAi({ companyId: "company-a", request, gateway: { runChatCompatibility } })).resolves.toEqual({ ok: false, reason: "ai_provider_error" });
  });
});
