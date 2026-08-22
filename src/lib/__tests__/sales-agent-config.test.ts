import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveSalesAgentLlmConfig } from "../sales-agent-config.server";

const read = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("SalesAgent LLM configuration", () => {
  it("exige endpoint, modelo e chave exclusivos", () => {
    expect(resolveSalesAgentLlmConfig({})).toEqual({
      ok: false,
      reason:
        "sales_agent_config_missing:SALES_AGENT_LLM_ENDPOINT,SALES_AGENT_LLM_MODEL,SALES_AGENT_LLM_API_KEY",
    });
    expect(
      resolveSalesAgentLlmConfig({
        SALES_AGENT_LLM_ENDPOINT: "https://llm.example.com/v1/chat/completions",
        SALES_AGENT_LLM_MODEL: "provider/sales-model",
        SALES_AGENT_LLM_API_KEY: "sales-key",
      }),
    ).toEqual({
      ok: true,
      config: {
        endpoint: "https://llm.example.com/v1/chat/completions",
        model: "provider/sales-model",
        apiKey: "sales-key",
      },
    });
  });

  it("não referencia a chave ou endpoint do Lovable", () => {
    const configSource = read("../sales-agent-config.server.ts");
    const agentSource = read("../ai-agent.server.ts");
    expect(`${configSource}\n${agentSource}`).not.toContain("LOVABLE_API_KEY");
    expect(`${configSource}\n${agentSource}`).not.toContain("ai.gateway.lovable.dev");
  });

  it("produção e treinamento compartilham somente o adaptador configurado do SalesAgent", () => {
    const agentSource = read("../ai-agent.server.ts");
    const trainingSource = read("../sales-training.functions.ts");
    expect(agentSource).toContain("resolveSalesAgentLlmConfig()");
    expect(agentSource).toContain("fetch(endpoint");
    expect(agentSource).toContain("core.decide({ ...params, model })");
    expect(trainingSource).toContain("runAgentTurn({ ctx, history");
    expect(trainingSource).not.toMatch(/LOVABLE_API_KEY|ai\.gateway\.lovable\.dev/);
  });

  it("mantém os fluxos de criativos com gateway e modelos atuais", () => {
    const creativeSource = read("../../routes/api.ai.creative-generator.tsx");
    expect(creativeSource).toContain("https://ai.gateway.lovable.dev/v1/chat/completions");
    expect(creativeSource).toContain("https://ai.gateway.lovable.dev/v1/images/generations");
    expect(creativeSource).toContain("process.env.LOVABLE_API_KEY");
    expect(creativeSource).toContain('model: "google/gemini-2.5-flash-image-preview"');
    expect(creativeSource).toContain('model: "openai/gpt-image-2"');
  });
});
