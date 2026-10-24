import { describe, expect, it, vi } from "vitest";
import { OpenAiResponsesGateway } from "@/lib/ai-platform/gateway.server";
import { resolveAiPlatformConfig } from "@/lib/ai-platform/config.server";
import { executiveNarrativeOpenAiEnabled } from "@/lib/executive-narrative/ExecutiveNarrativeService.server";
import { campaignAdvisorOpenAiEnabled } from "@/routes/api.ai.campaign-advisor";
import { campaignCreativeOpenAiEnabled } from "@/routes/api.ai.campaign-creative";
import { creativeGeneratorOpenAiEnabled } from "@/routes/api.ai.creative-generator";
import { proposeKnowledgeOpenAiEnabled } from "@/routes/api.ai.propose-knowledge";
import { suggestProductOpenAiEnabled } from "@/routes/api.ai.suggest-product";
import { suggestOpenAiEnabled } from "@/routes/api.ai.suggest";
import { recoveryAssistOpenAiEnabled } from "@/routes/api.recovery.assist";

const config = resolveAiPlatformConfig({
  OPENAI_API_KEY: "test-key",
  OPENAI_RESPONSES_URL: "https://api.openai.com/v1/responses",
  AI_RETRY_ATTEMPTS: "2",
} as NodeJS.ProcessEnv);

const specs = [
  { capability: "executive" as const, tool: null, output: { greeting: "Olá", summary: "Resumo autorizado", highlights: ["fato"], alerts: [], recommendations: [], generated_at: "2026-10-24T00:00:00.000Z", model: "legacy" } },
  { capability: "marketing" as const, tool: "campaign_advisory", output: { summary: "campanha", diagnosis: { health: "boa", strengths: [], risks: [] }, recommendations: [], creative_ideas: [], copy_ideas: [] } },
  { capability: "marketing" as const, tool: "generate_ad", output: { headline: "Produto autorizado", primary_text: "Conheça uma opção para sua rotina.", cta: "Saiba mais", social_caption: "Conheça", audience_suggestion: "famílias" } },
  { capability: "marketing" as const, tool: "generate_variants", output: { emotion: { headline: "Uma escolha para sua casa", primary_text: "Conheça o produto autorizado.", description: "Fale conosco", cta: "Saiba mais", image_prompt: "authorized product" }, offer: { headline: "Converse com nossa equipe", primary_text: "Tire suas dúvidas com a equipe.", description: "Atendimento", cta: "Enviar mensagem", image_prompt: "authorized product" }, urgency: { headline: "Veja se faz sentido", primary_text: "Confira os detalhes e converse conosco.", description: "Saiba mais", cta: "Solicitar orçamento", image_prompt: "authorized product" }, audience_suggestion: "famílias" } },
  { capability: "marketing" as const, tool: "propose_knowledge", output: { proposals: [{ type: "faq", question: "Qual a dúvida?", answer: "Consulte a equipe." }] } },
  { capability: "sales_agent" as const, tool: "suggest_product", output: { productId: "product-authorized", confidence: 0.8, reason: "correspondência com a necessidade" } },
  { capability: "copilot" as const, tool: "atende_ai_suggestion", output: { classification: "question", intent: "informação", nextAction: "responder", suggestedReply: "Vou verificar essa informação." } },
  { capability: "recovery" as const, tool: "recovery_plan", output: { probable_reason: "pode haver dúvida", strategy: "retomar", tone: "consultivo", insistence: "baixa", best_moment: "após revisão", cta: "confirmar interesse", primary_message: "Posso ajudar?", alternatives: [], explanation: "baseado nos fatos", template_name: null } },
] as const;

const scenarios = Array.from({ length: 56 }, (_, index) => {
  const spec = specs[index % specs.length];
  return { id: `scenario-${index + 1}`, companyId: `company-${(index % 7) + 1}`, spec };
});

describe("homologação integrada das funcionalidades OpenAI migradas", () => {
  it("mantém todas as flags desligadas por padrão", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect([
      executiveNarrativeOpenAiEnabled(env),
      campaignAdvisorOpenAiEnabled(env),
      campaignCreativeOpenAiEnabled(env),
      creativeGeneratorOpenAiEnabled(env),
      proposeKnowledgeOpenAiEnabled(env),
      suggestProductOpenAiEnabled(env),
      suggestOpenAiEnabled(env),
      recoveryAssistOpenAiEnabled(env),
    ]).toEqual([false, false, false, false, false, false, false, false]);
  });

  it("compara 56 cenários fictícios com o contrato legado em concorrência", async () => {
    const usage: Array<{ companyId: string; inputTokens: number; outputTokens: number }> = [];
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { input?: string; tools?: Array<{ name?: string }> };
      const scenarioId = String(request.input).match(/scenario-\d+/)?.[0];
      const scenario = scenarios.find((item) => item.id === scenarioId);
      if (!scenario) return new Response(JSON.stringify({ error: "scenario_not_found" }), { status: 400 });
      const body = scenario.spec.tool
        ? { id: `resp-${scenario.id}`, model: "gpt-6-luna", output: [{ type: "function_call", call_id: `call-${scenario.id}`, name: scenario.spec.tool, arguments: JSON.stringify(scenario.spec.output) }], usage: { input_tokens: 20, output_tokens: 12 } }
        : { id: `resp-${scenario.id}`, model: "gpt-6-luna", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(scenario.spec.output) }] }], usage: { input_tokens: 20, output_tokens: 12 } };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    const gateway = new OpenAiResponsesGateway(config, { fetchImpl, usageSink: { record: (event) => { usage.push(event); } } });
    const results = await Promise.all(scenarios.map(async (scenario) => {
      const result = await gateway.run({
        companyId: scenario.companyId,
        capability: scenario.spec.capability,
        input: `cenário fictício ${scenario.id}: somente dados autorizados`,
        tools: scenario.spec.tool ? [{ type: "function", name: scenario.spec.tool, parameters: { type: "object" }, strict: false }] : undefined,
        toolChoice: scenario.spec.tool ? { type: "function", name: scenario.spec.tool } : undefined,
        responseFormat: scenario.spec.tool ? undefined : "json",
        store: false,
      });
      const actual = scenario.spec.tool ? JSON.parse(result.toolCalls[0].arguments) : JSON.parse(result.outputText);
      expect(actual).toEqual(scenario.spec.output);
      if (scenario.spec.tool) expect(result.toolCalls[0].name).toBe(scenario.spec.tool);
      return result;
    }));
    expect(results).toHaveLength(56);
    expect(fetchImpl).toHaveBeenCalledTimes(56);
    expect(usage).toHaveLength(56);
    expect(new Set(usage.map((item) => item.companyId))).toEqual(new Set(scenarios.map((item) => item.companyId)));
    expect(usage.every((item) => item.inputTokens === 20 && item.outputTokens === 12)).toBe(true);
  });
});
