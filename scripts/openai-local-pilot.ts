import { OpenAiResponsesGateway } from "../src/lib/ai-platform/gateway.server";
import { isLocalOpenAiPilotCompanyEnabled } from "../src/lib/ai-platform/local-pilot.server";
import { AiPlatformError } from "../src/lib/ai-platform/types";
import { NARRATIVE_SYSTEM_PROMPT } from "../src/lib/executive-narrative/ExecutiveNarrativePrompt";

const companyId = process.env.OPENAI_LOCAL_PILOT_COMPANY_ID ?? "";
const env = process.env;
if (!isLocalOpenAiPilotCompanyEnabled(companyId, env)) {
  throw new Error("local_pilot_guard_blocked");
}

const cases = [
  { name: "executive", capability: "executive" as const, tool: null, fields: ["greeting", "summary", "priorities", "opportunities", "risks", "nextAction"] },
  { name: "campaign-advisor", capability: "marketing" as const, tool: "campaign_advisory", fields: ["summary", "diagnosis", "recommendations"] },
  { name: "campaign-creative", capability: "marketing" as const, tool: "generate_ad", fields: ["headline", "primary_text", "cta"] },
  { name: "creative-generator-text", capability: "marketing" as const, tool: "generate_variants", fields: ["emotion", "offer", "urgency", "audience_suggestion"] },
  { name: "propose-knowledge", capability: "marketing" as const, tool: "propose_knowledge", fields: ["proposals"] },
  { name: "suggest-product", capability: "sales_agent" as const, tool: "suggest_product", fields: ["productId", "confidence", "reason"] },
  { name: "suggest", capability: "copilot" as const, tool: "atende_ai_suggestion", fields: ["classification", "intent", "nextAction", "suggestedReply"] },
  { name: "recovery", capability: "recovery" as const, tool: "recovery_plan", fields: ["probable_reason", "strategy", "primary_message"] },
] as const;
const selectedCases = process.env.OPENAI_LOCAL_PILOT_FEATURE
  ? cases.filter((testCase) => testCase.name === process.env.OPENAI_LOCAL_PILOT_FEATURE)
  : cases;

function schema(fields: readonly string[]) {
  return {
    type: "object",
    properties: Object.fromEntries(fields.map((field) => [field, { type: field === "confidence" ? "number" : "string" }])),
    required: [...fields],
  };
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
}

function hasUnsupportedClaim(value: unknown): boolean {
  return collectStrings(value).some((text) => /(?:^|[.!?]\s*)(?:o produto|a oferta|a condição|ele|ela)\s+(?:está\s+)?disponível|últimas? unidades?|em estoque|desconto de|por apenas|promoção válida/i.test(text));
}

function parseJson(text: string): Record<string, unknown> {
  try { return JSON.parse(text) as Record<string, unknown>; } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("json_output_missing");
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

const gateway = new OpenAiResponsesGateway();
const results: Array<Record<string, unknown>> = [];

for (const testCase of selectedCases) {
  const startedAt = Date.now();
  try {
    const result = await gateway.run({
      companyId,
      capability: testCase.capability,
      instructions: testCase.name === "executive"
        ? NARRATIVE_SYSTEM_PROMPT
        : "Você está em um piloto local. Não envie mensagens. Use somente os fatos autorizados. Não invente preço, estoque, promoção, desconto, prazo ou produto. Gere resposta curta e comercialmente útil; perguntas são permitidas.",
      input: testCase.name === "executive"
        ? "Executivo: Teste\nMomento do dia: manhã\n\nSnapshot executivo (JSON — única fonte de verdade): {\"period\":\"piloto\",\"attendance\":{\"conversations\":10},\"sales\":{\"count\":3},\"followups\":{\"stalled\":2},\"dataQuality\":{\"tablesEmpty\":[],\"unavailableMetrics\":[],\"estimatedMetrics\":[],\"warnings\":[]}}"
        : `Cenário fictício do piloto ${testCase.name}: cliente perguntou sobre um produto autorizado, mas não há preço, estoque, promoção ou prazo autorizados. Responda apenas com dados disponíveis, preserve o contrato legado e retorne JSON quando o contrato exigir JSON.`,
      tools: testCase.tool ? [{ type: "function", name: testCase.tool, description: `Contrato legado de ${testCase.name}`, parameters: schema(testCase.fields), strict: false }] : undefined,
      toolChoice: testCase.tool ? { type: "function", name: testCase.tool } : undefined,
      responseFormat: testCase.tool ? undefined : "json",
      store: false,
      maxOutputTokens: testCase.name === "executive" ? 800 : 320,
      tags: { feature: "local_openai_pilot", pilot_company: companyId },
    });
    const payload = testCase.tool
      ? JSON.parse(result.toolCalls[0]?.arguments ?? "{}")
      : parseJson(result.outputText || "{}");
    const missingFields = testCase.fields.filter((field) => !(field in payload));
    results.push({
      feature: testCase.name,
      status: missingFields.length === 0 ? "passed" : "contract_mismatch",
      model: result.model,
      latencyMs: Date.now() - startedAt,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estimatedCostUsd: result.estimatedCostUsd,
      fallback: false,
      legacyContractMatch: missingFields.length === 0,
      missingFields,
      unsupportedClaim: hasUnsupportedClaim(payload),
    });
  } catch (error) {
    results.push({
      feature: testCase.name,
      status: "error",
      latencyMs: Date.now() - startedAt,
      fallback: false,
      errorCode: error instanceof AiPlatformError ? error.code : error instanceof Error ? error.name : "unknown",
      errorMessage: error instanceof Error ? error.message : undefined,
    });
  }
}

console.log(JSON.stringify({
  pilot: "local-single-company",
  companyId,
  realCalls: results.length,
  rollbackGuardForOtherCompany: !isLocalOpenAiPilotCompanyEnabled("other-company", env),
  noMetaSend: true,
  results,
}, null, 2));
