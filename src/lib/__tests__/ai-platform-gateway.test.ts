import { describe, expect, it, vi } from "vitest";
import { resolveAiPlatformConfig } from "../ai-platform/config.server";
import { chatMessagesToResponsesInput, chatToolsToResponsesTools } from "../ai-platform/compatibility.server";
import { OpenAiResponsesGateway } from "../ai-platform/gateway.server";
import { AiPlatformError } from "../ai-platform/types";

const config = resolveAiPlatformConfig({
  OPENAI_API_KEY: "test-key",
  OPENAI_RESPONSES_URL: "https://api.openai.com/v1/responses",
  AI_MODEL_FOLLOWUP: "gpt-6-luna",
  AI_RETRY_ATTEMPTS: "2",
} as NodeJS.ProcessEnv);

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("OpenAI Responses gateway", () => {
  it("parses text and tool calls without exposing prompts to metrics", async () => {
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body));
      expect(requestBody).toMatchObject({ model: "gpt-6-luna", store: false });
      expect(requestBody.instructions).toContain("You are helpful");
      expect(requestBody.tools[0]).toMatchObject({ type: "function", name: "lookup" });
      expect(init?.headers).toMatchObject({ authorization: "Bearer test-key" });
      return response({ id: "resp_test", model: "gpt-6-luna", output: [
        { type: "message", content: [{ type: "output_text", text: "Olá" }] },
        { type: "function_call", call_id: "call_1", name: "lookup", arguments: '{"sku":"1"}' },
      ], usage: { input_tokens: 10, output_tokens: 4, input_tokens_details: { cached_tokens: 2 }, output_tokens_details: { reasoning_tokens: 1 } } });
    });
    const sink = { record: vi.fn() };
    const gateway = new OpenAiResponsesGateway(config, { fetchImpl, usageSink: sink });
    const result = await gateway.runChatCompatibility({
      companyId: "company-a", capability: "followup",
      messages: [{ role: "system", content: "You are helpful" }, { role: "user", content: "Oi" }],
      tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
    });
    expect(result.choices[0].message.content).toBe("Olá");
    expect(result.choices[0].message.tool_calls?.[0].function.arguments).toBe('{"sku":"1"}');
    expect(result.choices[0].finish_reason).toBe("tool_calls");
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 });
    expect(sink.record).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company-a", inputTokens: 10, outputTokens: 4 }));
  });

  it("retries rate limits and does not retry client errors", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn().mockResolvedValueOnce(response({ error: "busy" }, 429)).mockResolvedValueOnce(response({ id: "resp_2", model: "gpt-6-luna", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }], usage: { input_tokens: 1, output_tokens: 1 } }));
    const gateway = new OpenAiResponsesGateway(config, { fetchImpl, sleep });
    await expect(gateway.run({ companyId: "company-a", capability: "followup", input: "Oi" })).resolves.toMatchObject({ id: "resp_2", attempts: 2 });
    expect(sleep).toHaveBeenCalledTimes(1);
    const clientError = vi.fn(async () => response({ error: "bad" }, 400));
    const clientGateway = new OpenAiResponsesGateway(config, { fetchImpl: clientError });
    await expect(clientGateway.run({ companyId: "company-a", capability: "followup", input: "Oi" })).rejects.toMatchObject({ code: "ai_provider_error", retryable: false });
    expect(clientError).toHaveBeenCalledTimes(1);
  });

  it("preserva a escolha explícita de ferramenta no Responses API", async () => {
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body));
      expect(requestBody.tool_choice).toEqual({ type: "function", name: "campaign_advisory" });
      return response({ id: "resp_tool", model: "gpt-6-luna", output: [{ type: "function_call", call_id: "call_1", name: "campaign_advisory", arguments: '{"summary":"ok"}' }], usage: { input_tokens: 3, output_tokens: 4 } });
    });
    const gateway = new OpenAiResponsesGateway(config, { fetchImpl });
    await expect(gateway.run({
      companyId: "company-a", capability: "marketing", input: "dados fictícios",
      tools: [{ type: "function", name: "campaign_advisory", parameters: { type: "object" } }],
      toolChoice: { type: "function", name: "campaign_advisory" },
    })).resolves.toMatchObject({ toolCalls: [{ name: "campaign_advisory" }] });
  });

  it("rejeita resposta sem texto ou tool call, sem mascarar saída vazia", async () => {
    const gateway = new OpenAiResponsesGateway(config, {
      fetchImpl: async () => response({
        id: "resp_empty",
        status: "incomplete",
        output: [{ type: "reasoning", summary: [] }],
        incomplete_details: { reason: "max_output_tokens" },
        usage: { input_tokens: 10, output_tokens: 80, output_tokens_details: { reasoning_tokens: 80 } },
      }),
    });
    await expect(gateway.run({ companyId: "company-a", capability: "followup", input: "Oi", maxOutputTokens: 80 })).rejects.toMatchObject({
      code: "ai_invalid_response",
    });
  });

  it("requires tenant context and validates HTTPS configuration", async () => {
    const gateway = new OpenAiResponsesGateway(config);
    await expect(gateway.run({ companyId: "", capability: "followup", input: "Oi" })).rejects.toBeInstanceOf(AiPlatformError);
    expect(() => resolveAiPlatformConfig({ OPENAI_API_KEY: "key", OPENAI_RESPONSES_URL: "http://localhost" } as NodeJS.ProcessEnv)).toThrow("HTTPS");
    expect(resolveAiPlatformConfig({ OPENAI_API_KEY: "key" } as NodeJS.ProcessEnv).storeResponses).toBe(false);
  });
});

describe("Responses compatibility adapters", () => {
  it("keeps instructions separate and flattens function tools", () => {
    expect(chatMessagesToResponsesInput([{ role: "system", content: "A" }, { role: "developer", content: "B" }, { role: "user", content: "C" }])).toEqual({ instructions: "A\n\nB", input: [{ role: "user", content: "C" }] });
    expect(chatToolsToResponsesTools([{ type: "function", function: { name: "f", description: "F", parameters: { type: "object" } } }])).toEqual([{ type: "function", name: "f", description: "F", parameters: { type: "object" }, strict: false }]);
  });

  it("maps JSON compatibility to Responses text.format", async () => {
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body));
      expect(requestBody.text).toEqual({ format: { type: "json_object" } });
      return response({ id: "resp_json", model: "gpt-6-luna", output: [{ type: "message", content: [{ type: "output_text", text: '{"date":null}' }] }], usage: { input_tokens: 2, output_tokens: 3 } });
    });
    const gateway = new OpenAiResponsesGateway(config, { fetchImpl });
    await expect(gateway.runChatCompatibility({
      companyId: "company-a", capability: "followup", responseFormat: "json",
      messages: [{ role: "user", content: "Oi" }],
    })).resolves.toMatchObject({ choices: [{ message: { content: '{"date":null}' } }] });
  });

  it("envia schema estrito para saída estruturada", async () => {
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body));
      expect(requestBody.text.format).toEqual(expect.objectContaining({
        type: "json_schema",
        name: "executive_narrative",
        strict: true,
        schema: expect.objectContaining({ required: ["greeting"] }),
      }));
      expect(requestBody.reasoning).toEqual({ effort: "low", mode: "standard" });
      return response({ id: "resp_schema", model: "gpt-6-luna", output: [{ type: "message", content: [{ type: "output_text", text: '{"greeting":"Olá"}' }] }], usage: { input_tokens: 2, output_tokens: 3 } });
    });
    const gateway = new OpenAiResponsesGateway(config, { fetchImpl });
    await expect(gateway.run({
      companyId: "company-a", capability: "executive", input: "snapshot fictício",
      responseFormat: { type: "json_schema", name: "executive_narrative", schema: { type: "object", required: ["greeting"] }, strict: true },
      reasoning: { effort: "low", mode: "standard" },
    })).resolves.toMatchObject({ outputText: '{"greeting":"Olá"}' });
  });
});
