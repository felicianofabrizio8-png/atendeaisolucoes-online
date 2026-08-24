import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  classifyHistoricalLlmStatus,
  extractHistoricalLearningDraft,
  HistoricalLearningAiError,
} from "../historical-learning-extractor.server";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const extractorSource = read("../historical-learning-extractor.server.ts");
const serviceSource = read("../historical-learning.service.ts");
const salesAgentSource = read("../../ai-agent.server.ts");
const creativeSource = read("../../../routes/api.ai.creative-generator.tsx");

const env = {
  SALES_AGENT_LLM_ENDPOINT: "https://llm.example.com/v1/chat/completions",
  SALES_AGENT_LLM_MODEL: "provider/model",
  SALES_AGENT_LLM_API_KEY: "test-secret",
};

describe("historical learning extractor", () => {
  it("usa a configuracao do SalesAgent em uma chamada JSON separada", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("provider/model");
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body.tools).toBeUndefined();
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer test-secret");
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  category: "closing",
                  product_ref: null,
                  title: "Confirmar o proximo passo",
                  description: "Conduzir o fechamento de forma objetiva.",
                  rule_structured: "Confirmar interesse e combinar o proximo passo.",
                  positive_example: "Posso confirmar o proximo passo com voce?",
                  negative_example: null,
                  priority: 70,
                  confidence: 0.8,
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await extractHistoricalLearningDraft({
      companyId: "company-a",
      userExplanation: "Conversa comercial anonimizada",
      env,
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.model).toBe("provider/model");
    expect(result.draft.category).toBe("closing");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("classifica config, auth, credito, rate limit, http e formato sem corpo bruto", async () => {
    await expect(
      extractHistoricalLearningDraft({ companyId: "company-a", userExplanation: "x", env: {} }),
    ).rejects.toMatchObject({ kind: "config", message: "historical_learning_ai_config" });
    expect(classifyHistoricalLlmStatus(401)).toBe("auth");
    expect(classifyHistoricalLlmStatus(403)).toBe("auth");
    expect(classifyHistoricalLlmStatus(402)).toBe("credit");
    expect(classifyHistoricalLlmStatus(429)).toBe("rate_limit");
    expect(classifyHistoricalLlmStatus(500)).toBe("http");
    const invalidJsonFetch = vi.fn(async () => new Response("not-json", { status: 200 }));
    await expect(
      extractHistoricalLearningDraft({
        companyId: "company-a",
        userExplanation: "x",
        env,
        fetchImpl: invalidJsonFetch as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(HistoricalLearningAiError);
    expect(extractorSource).not.toMatch(/response\.text\(|rawBody|body bruto/i);
  });

  it("sanitiza falhas de autenticacao e classifica timeout", async () => {
    const authFetch = vi.fn(async () => new Response("secret provider body", { status: 401 }));
    const authFailure = extractHistoricalLearningDraft({
      companyId: "company-a",
      userExplanation: "x",
      env,
      fetchImpl: authFetch as typeof fetch,
    });

    await expect(authFailure).rejects.toMatchObject({
      kind: "auth",
      status: 401,
      message: "historical_learning_ai_auth",
    });
    await expect(authFailure).rejects.not.toThrow("secret provider body");

    const timeoutFetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );

    await expect(
      extractHistoricalLearningDraft({
        companyId: "company-a",
        userExplanation: "x",
        env,
        fetchImpl: timeoutFetch as typeof fetch,
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({
      kind: "timeout",
      status: null,
      message: "historical_learning_ai_timeout",
    });
  });

  it("nao usa Lovable no historico e nao altera os consumidores existentes", () => {
    expect(`${extractorSource}\n${serviceSource}`).not.toMatch(
      /LOVABLE_API_KEY|ai\.gateway\.lovable/i,
    );
    expect(extractorSource).toContain("resolveSalesAgentLlmConfig");
    expect(salesAgentSource).toContain("core.decide({ ...contextualParams, model })");
    expect(creativeSource).toContain("LOVABLE_API_KEY");
  });
});
